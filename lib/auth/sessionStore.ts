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
  /** IANA zone. Absent means "trust the device". */
  timezone?: string
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

      // Access likely expired — try refresh once.
      const rotated = await tryRefresh(refreshToken)
      if (rotated) {
        const me = await tryFetchMe(rotated.accessToken)
        if (me) {
          storageSet(ACCESS_KEY, rotated.accessToken)
          storageSet(REFRESH_KEY, rotated.refreshToken)
          useSessionStore.setState({
            accessToken: rotated.accessToken,
            refreshToken: rotated.refreshToken,
            user: me,
            status: 'authenticated',
          })
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

async function tryRefresh(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${resolveApiBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      tokens: { accessToken: string; refreshToken: string }
    }
    return data.tokens
  } catch {
    return null
  }
}

export const selectStatus = (s: SessionState): SessionStatus => s.status
export const selectUser = (s: SessionState): AuthUser | null => s.user
export const selectAccessToken = (s: SessionState): string | null => s.accessToken
export const selectRefreshToken = (s: SessionState): string | null => s.refreshToken
