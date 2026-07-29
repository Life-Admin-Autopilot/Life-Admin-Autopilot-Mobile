import { Router } from 'express'

import { env } from '../env'
import { BadRequest, NotFound, Unauthorized, asyncHandler } from '../lib/errors'
import { isTokenCipherConfigured } from '../lib/tokenCipher'
import { logger } from '../logger'
import { requireAuth } from '../middleware/auth'
import {
  disconnectGoogle,
  findGoogleIntegration,
  saveGoogleConnection,
} from '../modules/integrations/google/connection'
import {
  buildAuthorizeUrl,
  exchangeCode,
  isGoogleConfigured,
} from '../modules/integrations/google/oauthClient'
import { issueOAuthState, verifyOAuthState } from '../modules/integrations/google/oauthState'
import { syncGoogleCalendar } from '../modules/integrations/google/syncGoogleCalendar'
import { syncGoogleTasks } from '../modules/integrations/google/syncGoogleTasks'
import { User } from '../models/User'

export const integrationsGoogleRouter = Router()

// Google OAuth, three legs:
//
//   1. POST /integrations/google/authorize   (authenticated) -> returns a URL
//   2. GET  /integrations/google/callback    (NOT authenticated — Google's
//                                             redirect carries no session)
//   3. deep link back into the app
//
// Leg 2 is why oauthState exists. It arrives as a bare GET with no cookie and
// no Authorization header, so the signed `state` is the only thing binding the
// incoming tokens to a Kitto account.
//
// Leg 1 returns a URL rather than redirecting because the CALLER must open it
// in the system browser. Google refuses OAuth inside an embedded webview
// (`disallowed_useragent`), which is exactly what the Capacitor shell is — a
// 302 from here would land the user in a dead end.

// Deliberately inert: no script, no styling hooks, nothing to interact with.
// Its only job is to tell a human the tab has done its work.
const CONNECTED_PAGE = `<!doctype html><meta charset="utf-8">
<title>Connected</title>
<body style="font-family:system-ui;padding:3rem;text-align:center">
<h1 style="font-size:1.25rem">Google connected</h1>
<p style="color:#666">You can close this tab and go back to Kitto.</p>
</body>`

function deepLink(status: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ status, ...extra })
  return `${env().APP_DEEP_LINK_SCHEME}://integrations/google?${params.toString()}`
}

/** True when the server can actually complete a connection end to end. */
function ready(): boolean {
  return isGoogleConfigured() && isTokenCipherConfigured()
}

integrationsGoogleRouter.post(
  '/integrations/google/authorize',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    if (!ready()) {
      throw BadRequest(
        'google_not_configured',
        'Connecting a Google account is not available yet.',
      )
    }

    // The caller says which shell it is. A browser has no app to deep-link
    // back into, so its exit is a plain page instead.
    const web = req.body?.web === true
    res.status(200).json({ url: buildAuthorizeUrl(issueOAuthState(auth.sub, web)) })
  }),
)

integrationsGoogleRouter.get(
  '/integrations/google/callback',
  asyncHandler(async (req, res) => {
    // Every exit from here is a REDIRECT to the app, never JSON. The user is
    // looking at a system browser tab, and a raw error body is both useless to
    // them and a dead end — the app would keep waiting for a deep link that
    // never comes.
    const fail = (reason: string): void => {
      res.redirect(302, deepLink('error', { reason }))
    }

    // The user pressed Cancel on the consent screen. Not an error; the app
    // should just close the browser quietly.
    const declined = typeof req.query.error === 'string' ? req.query.error : undefined
    if (declined) {
      res.redirect(302, deepLink(declined === 'access_denied' ? 'cancelled' : 'error'))
      return
    }

    let claims: { userId: string; web: boolean }
    try {
      claims = verifyOAuthState(typeof req.query.state === 'string' ? req.query.state : undefined)
    } catch (err: unknown) {
      // Deliberately vague to the caller. A forged or expired state is either
      // an attack or a stale tab, and neither deserves a description of which
      // check failed.
      logger.warn({ err }, 'google:callback:bad-state')
      fail('invalid_state')
      return
    }

    const code = typeof req.query.code === 'string' ? req.query.code : undefined
    if (!code) {
      fail('no_code')
      return
    }

    try {
      const { tokens, identity } = await exchangeCode(code)
      await saveGoogleConnection(claims.userId, tokens, identity)
    } catch (err: unknown) {
      logger.error({ err, userId: claims.userId }, 'google:callback:exchange-failed')
      fail('exchange_failed')
      return
    }

    if (claims.web) {
      // Nothing to redirect to — a browser tab cannot follow kitto://. The tab
      // says its piece and the app picks the change up when it regains focus.
      res.status(200).type('html').send(CONNECTED_PAGE)
      return
    }
    res.redirect(302, deepLink('connected'))
  }),
)

integrationsGoogleRouter.get(
  '/integrations/google',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const integration = await findGoogleIntegration(auth.sub)
    res.status(200).json({
      available: ready(),
      // toJSON strips every token field — see models/Integration.ts.
      integration: integration ? integration.toJSON() : null,
    })
  }),
)

// POST /integrations/google/sync — pull now.
//
// Runs Calendar and Tasks in sequence and reports both. Sequential rather than
// parallel on purpose: they share one access token, and a concurrent refresh
// from both would race to write the same row.
integrationsGoogleRouter.post(
  '/integrations/google/sync',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const integration = await findGoogleIntegration(auth.sub)
    if (!integration) throw NotFound('not_connected', 'No Google account is connected.')

    const user = await User.findById(auth.sub).select('timezone imports')
    if (!user?.timezone) {
      throw BadRequest(
        'timezone_required',
        'Set your timezone before importing — Google items have no timezone of their own.',
      )
    }

    const options = {
      timezone: user.timezone,
      defaultTimeOfDay: user.imports?.defaultTimeOfDay,
      domain: integration.importDomain,
    }

    const calendar = await syncGoogleCalendar(integration, options)
    const tasks = await syncGoogleTasks(integration, options)

    res.status(200).json({ integration: integration.toJSON(), calendar, tasks })
  }),
)

integrationsGoogleRouter.delete(
  '/integrations/google',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const integration = await findGoogleIntegration(auth.sub)
    if (!integration) throw NotFound('not_connected', 'No Google account is connected.')

    await disconnectGoogle(integration)
    res.status(200).json({ removed: true })
  }),
)
