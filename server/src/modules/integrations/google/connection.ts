// Owns the lifecycle of a stored Google connection: minting usable access
// tokens, persisting refreshes, and deciding when a connection is genuinely
// dead rather than briefly unhappy.
//
// That last distinction is the whole point of this module. `invalid_grant` from
// Google means the refresh token will NEVER work again — the user revoked
// access from their Google account page, changed their password, or left it
// unused for six months. Retrying it is not just futile, it is harmful: the
// poller would spin forever while the user sees a connection that claims to be
// fine and reminders that quietly stopped. So that one error transitions the
// row to `needs_reauth` and the UI is expected to say so.

import { logger } from '../../../logger'
import { Integration, type IntegrationDoc } from '../../../models/Integration'
import { decryptSecret, encryptSecret, isTokenCipherConfigured } from '../../../lib/tokenCipher'
import {
  GoogleOAuthError,
  refreshAccessToken,
  revokeToken,
  type GoogleIdentity,
  type GoogleTokens,
} from './oauthClient'

export class IntegrationUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationUnavailableError'
  }
}

export async function findGoogleIntegration(userId: string): Promise<IntegrationDoc | null> {
  return Integration.findOne({ userId, provider: 'google' })
}

/**
 * Create or update the connection after a successful consent.
 *
 * Upserts rather than inserts: reconnecting must replace the row, because a
 * second row would strand a refresh token that nothing ever revokes.
 *
 * The refresh token is preserved when Google omits it. Google only returns one
 * on a consent screen that actually prompted, so a re-consent that happens to
 * skip it must not blank the only durable credential we hold.
 */
export async function saveGoogleConnection(
  userId: string,
  tokens: GoogleTokens,
  identity: GoogleIdentity | null,
): Promise<IntegrationDoc> {
  if (!isTokenCipherConfigured()) {
    throw new IntegrationUnavailableError('Token storage is not configured on this server.')
  }

  const existing = await findGoogleIntegration(userId)
  const refreshTokenEnc = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken)
    : existing?.refreshTokenEnc

  if (!refreshTokenEnc) {
    // No new token and nothing stored — the connection would be dead on
    // arrival. Almost always means access_type=offline or prompt=consent was
    // dropped from the authorize URL.
    throw new IntegrationUnavailableError(
      'Google did not return a refresh token. Try connecting again.',
    )
  }

  const now = new Date()
  const update = {
    userId,
    provider: 'google' as const,
    externalAccountId: identity?.sub ?? existing?.externalAccountId ?? 'unknown',
    externalAccountEmail: identity?.email ?? existing?.externalAccountEmail,
    refreshTokenEnc,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    accessTokenExpiresAt: tokens.expiresAt,
    grantedScopes: tokens.grantedScopes,
    status: 'active' as const,
    lastError: undefined,
    connectedAt: existing?.connectedAt ?? now,
    revokedAt: undefined,
  }

  return Integration.findOneAndUpdate({ userId, provider: 'google' }, { $set: update }, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  })
}

/**
 * A usable access token, refreshing if the cached one has lapsed.
 *
 * Throws IntegrationUnavailableError when the connection needs the user's
 * attention — callers should surface that rather than retry.
 */
export async function getAccessToken(integration: IntegrationDoc): Promise<string> {
  if (integration.status !== 'active') {
    throw new IntegrationUnavailableError('That Google account needs reconnecting.')
  }

  const cached = integration.accessTokenEnc
  const expiry = integration.accessTokenExpiresAt
  if (cached && expiry && expiry.getTime() > Date.now()) {
    try {
      return decryptSecret(cached)
    } catch (err: unknown) {
      // A cached token we cannot read is not fatal — it is a cache. Fall
      // through to a refresh rather than failing the request.
      logger.warn({ err, integrationId: integration.id }, 'google:access-token-unreadable')
    }
  }

  let refreshToken: string
  try {
    refreshToken = decryptSecret(integration.refreshTokenEnc)
  } catch (err: unknown) {
    // The refresh token is the durable credential. If THAT will not decrypt,
    // the encryption key changed or the row is corrupt, and no amount of
    // retrying fixes it — the user has to reconnect.
    logger.error({ err, integrationId: integration.id }, 'google:refresh-token-unreadable')
    await markNeedsReauth(integration, 'Stored credentials could not be read.')
    throw new IntegrationUnavailableError('That Google account needs reconnecting.')
  }

  try {
    const tokens = await refreshAccessToken(refreshToken)
    integration.accessTokenEnc = encryptSecret(tokens.accessToken)
    integration.accessTokenExpiresAt = tokens.expiresAt
    // A refresh response carries the CURRENT grant, so scopes the user has
    // since removed disappear here. Keeping the stale list would let a sync
    // call an API it no longer has permission for and 403 on every tick.
    if (tokens.grantedScopes.length > 0) integration.grantedScopes = tokens.grantedScopes
    integration.lastError = undefined
    await integration.save()
    return tokens.accessToken
  } catch (err: unknown) {
    if (err instanceof GoogleOAuthError && err.needsReauth) {
      await markNeedsReauth(integration, 'Kitto lost access to your Google account.')
      throw new IntegrationUnavailableError('That Google account needs reconnecting.')
    }
    // Anything else — a timeout, a 5xx — is transient. Leave the row active so
    // the next poll tries again.
    throw err
  }
}

async function markNeedsReauth(integration: IntegrationDoc, reason: string): Promise<void> {
  integration.status = 'needs_reauth'
  integration.lastError = reason
  await integration.save()
}

/** Does this connection actually carry the scope a sync needs? */
export function hasScope(integration: IntegrationDoc, scope: string): boolean {
  return integration.grantedScopes.includes(scope)
}

/**
 * Disconnect, and tell Google too.
 *
 * The revoke call is best-effort: if it fails the local row is still removed,
 * because a user who pressed Disconnect must not be left connected by a network
 * blip on our side. The reverse (dropping the row but staying authorised at
 * Google) is the failure that matters, and this ordering avoids it.
 */
export async function disconnectGoogle(integration: IntegrationDoc): Promise<void> {
  try {
    const refreshToken = decryptSecret(integration.refreshTokenEnc)
    await revokeToken(refreshToken)
  } catch (err: unknown) {
    logger.warn({ err, integrationId: integration.id }, 'google:revoke-failed')
  }
  await integration.deleteOne()
}
