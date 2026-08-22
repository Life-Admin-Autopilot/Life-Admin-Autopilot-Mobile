// Session store — Zustand mirror of the backend's auth state (web rebuild).
//
// Holds the access JWT + opaque refresh token and the current user. v1 used
// expo-secure-store on native; on web we persist to localStorage (guarded for
// SSR / the static-export prerender, where `window` is absent). On Capacitor
// native this is the swap point for @capacitor/preferences + Secure Storage —
// deferred until we wrap native (see docs/PORTING-GUIDE.md).
//
// The shape (accessToken / refreshToken / setTokens / clear) matches what
// lib/api/client.ts reads, so the API client ports unchanged. Selectors return
// primitives — no useShallow required.

import { create } from 'zustand'

import { resolveApiBaseUrl } from '@/lib/api/baseUrl'
import { logger } from '@/lib/logger'

// One captured onboarding answer — AI personalization memory (mirrors the
// backend OnboardingAnswer).
export interface OnboardingAnswer {
  id: string
  question: string
  answer: string
}

export type Theme = 'system' | 'light' | 'dark'
export type SubscriptionTier = 'free' | 'pro'

export interface NotificationPrefs {
  push: boolean
  emailDigest: boolean
  marketing: boolean
}

export interface SubscriptionState {
  tier: SubscriptionTier
  renewsAt?: string
  canceledAt?: string
}

// Mirrors the server's `User.toJSON()`. Only the fields a surface actually
// renders are typed — the backend also stores textSize/mic/privacy, which
// nothing on either side reads yet, so typing them here would advertise
// settings the app cannot honour.
export interface AuthUser {
  id: string
  email: string
  /** Requested but unconfirmed address; the account still signs in as `email`. */
  pendingEmail?: string
  /**
   * False for magic-link-only accounts. Surfaces re-confirm with a password
   * only when there is one to give — the hash itself never reaches the client.
   */
  hasPassword?: boolean
  displayName?: string
  preferredDomains: string[]
  hasOnboarded: boolean
  onboardingAnswers?: OnboardingAnswer[]
  emailVerifiedAt?: string
  /** IANA zone. Always set on accounts created since the server got a default. */
  timezone?: string
  /**
   * True while `timezone` is still the server's default rather than a zone the
   * user picked. Absent on accounts that predate the flag, which read as true.
   */
  timezoneFollowsDevice?: boolean
  /** BCP 47 tag. */
  /** Effective language. Absent only on accounts that predate the picker. */
  locale?: string
  /** True when `locale` was read off a device — do not adopt it on another one. */
  localeFollowsDevice?: boolean
  theme?: Theme
  notifications?: NotificationPrefs
  subscription?: SubscriptionState
  createdAt: string
  updatedAt: string
}

export type SessionStatus = 'loading' | 'unauthenticated' | 'authenticated'

interface AuthResponse {
  user: AuthUser
  tokens: { accessToken: string; refreshToken: string }
}

interface SessionState {
  status: SessionStatus
  accessToken: string | null
  refreshToken: string | null
  user: AuthUser | null
  setSession: (payload: AuthResponse) => Promise<void>
  setTokens: (accessToken: string, refreshToken: string) => Promise<void>
  setUser: (user: AuthUser) => void
  clear: () => Promise<void>
}

const ACCESS_KEY = 'lifeadmin.access-token'
const REFRESH_KEY = 'lifeadmin.refresh-token'

// localStorage is unavailable during the static-export prerender and in the
// Capacitor file:// edge cases — fail soft so a read/write never throws.
function storageGet(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* quota / disabled storage — tokens just won't persist across reloads */
  }
}

function storageDelete(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  accessToken: null,
  refreshToken: null,
  user: null,

  setSession: async ({ user, tokens }) => {
    storageSet(ACCESS_KEY, tokens.accessToken)
    storageSet(REFRESH_KEY, tokens.refreshToken)
    set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user,
      status: 'authenticated',
    })
  },

  setTokens: async (accessToken, refreshToken) => {
    storageSet(ACCESS_KEY, accessToken)
    storageSet(REFRESH_KEY, refreshToken)
    set({ accessToken, refreshToken })
  },

  setUser: (user) => set({ user }),

  clear: async () => {
    storageDelete(ACCESS_KEY)
    storageDelete(REFRESH_KEY)
    set({ accessToken: null, refreshToken: null, user: null, status: 'unauthenticated' })
  },
}))

// ---- Rotation ------------------------------------------------------------
//
// THE server rotates refresh tokens and invalidates the old one immediately, so
// a refresh token is single-use. Two callers presenting the same one is not a
// theoretical race: measured against the live server, concurrent refreshes with
// one token return 200 and 401 — exactly one wins.
//
// That matters because losing the race used to sign the user out. The loser saw
// a 401, treated it as "your session is dead", and wiped storage — while the
// winner had just installed a perfectly good pair. The user was ejected
// mid-session for a condition that had already resolved itself.
//
// Rotation therefore lives HERE, next to the tokens, and there is exactly one
// implementation. Boot hydration and the API layer both call it, so they can no
// longer race each other.
let rotation: Promise<boolean> | null = null

/**
 * Exchange the stored refresh token for a new pair.
 *
 * Returns true when the store now holds a usable access token — which includes
 * the case where THIS call failed but a concurrent one already succeeded.
 * Callers should re-read `accessToken` and retry rather than assuming the token
 * they started with.
 */
export function refreshSession(): Promise<boolean> {
  if (rotation) return rotation

  rotation = (async () => {
    const before = useSessionStore.getState().refreshToken
    if (!before) return false

    // Has the session moved out from under this rotation while it was in flight?
    // Whatever moved it outranks the pair this call is holding:
    //   - a DIFFERENT token → a concurrent rotation got there first and its pair
    //     is the live one; ours is already spent. The session is healthy, so a
    //     401 here says nothing about it — signing the user out would be the bug.
    //   - NULL → clear() ended the session (sign-out, account deletion). There is
    //     no session left to install a pair into.
    //
    // The null case is why this check has to guard the SUCCESS path too. Writing
    // a fresh pair after clear() resurrects the session: the tokens land back in
    // localStorage, the next boot validates them against /auth/me, status flips
    // to 'authenticated', and the guest guard bounces the signed-out user off
    // /sign-in to /dashboard — for good.
    //
    // Returns null when nothing moved and this call should proceed.
    const supersededBy = (): boolean | null => {
      const settled = useSessionStore.getState().refreshToken
      if (settled === before) return null
      return settled !== null
    }

    try {
      const res = await fetch(`${resolveApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: before }),
      })

      if (res.ok) {
        const data = (await res.json()) as { tokens: { accessToken: string; refreshToken: string } }
        const supersededOnSuccess = supersededBy()
        if (supersededOnSuccess !== null) return supersededOnSuccess
        storageSet(ACCESS_KEY, data.tokens.accessToken)
        storageSet(REFRESH_KEY, data.tokens.refreshToken)
        useSessionStore.setState({
          accessToken: data.tokens.accessToken,
          refreshToken: data.tokens.refreshToken,
        })
        return true
      }

      const supersededOnFailure = supersededBy()
      if (supersededOnFailure !== null) return supersededOnFailure

      // Only now is it genuinely dead: the server rejected the CURRENT token and
      // nobody replaced it. A 5xx is not that, and must not cost a session.
      if (res.status === 401 || res.status === 403) {
        await useSessionStore.getState().clear()
      }
      return false
    } catch (err: unknown) {
      // Offline or DNS failure. The tokens are almost certainly still valid, so
      // this fails the request without touching the session.
      logger.warn('sessionStore:refresh-failed', err)
      return false
    } finally {
      rotation = null
    }
  })()

  return rotation
}

let booted = false

// Hydrate the session from storage once, on the client. Validates the access
// token against /auth/me and refreshes once if it's expired. Call from a client
// component in the app shell (see app/providers.tsx).
export function bootSessionStore(): void {
  if (booted) return
  booted = true

  void (async () => {
    try {
      const accessToken = storageGet(ACCESS_KEY)
      const refreshToken = storageGet(REFRESH_KEY)

      if (!accessToken || !refreshToken) {
        useSessionStore.setState({ status: 'unauthenticated' })
        return
      }

      // Make tokens available to fetches before we validate.
      useSessionStore.setState({ accessToken, refreshToken })

      const validated = await tryFetchMe(accessToken)
      if (validated) {
        useSessionStore.setState({ user: validated, status: 'authenticated' })
        return
      }

      // Access likely expired — rotate through the SHARED path.
      //
      // This used to be its own fetch, which meant boot and the first component
      // query could present the same single-use refresh token at the same
      // moment. One won, one 401'd, and the loser wiped the session — a cold
      // start with an expired access token could log you out at random.
      const rotated = await refreshSession()
      if (rotated) {
        const me = await tryFetchMe(useSessionStore.getState().accessToken ?? '')
        if (me) {
          useSessionStore.setState({ user: me, status: 'authenticated' })
          return
        }
      }

      // Tokens are no good. Wipe and surface unauthenticated.
      storageDelete(ACCESS_KEY)
      storageDelete(REFRESH_KEY)
      useSessionStore.setState({
        accessToken: null,
        refreshToken: null,
        user: null,
        status: 'unauthenticated',
      })
    } catch (err: unknown) {
      logger.warn('sessionStore:boot-failed', err)
      useSessionStore.setState({ status: 'unauthenticated' })
    }
  })()
}

async function tryFetchMe(accessToken: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { user: AuthUser }
    return data.user
  } catch {
    return null
  }
}

// (tryRefresh removed — a second, undeduped rotation path was the whole bug.
//  Everything now goes through refreshSession above.)

export const selectStatus = (s: SessionState): SessionStatus => s.status
export const selectUser = (s: SessionState): AuthUser | null => s.user
export const selectAccessToken = (s: SessionState): string | null => s.accessToken
export const selectRefreshToken = (s: SessionState): string | null => s.refreshToken
