import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auth, request, signUp } from '../test/helpers'
import { sendEmail } from '../lib/email'

// The code only ever exists in the outbound email — VerificationToken stores a
// salted hash of it, by design. So the transport is mocked and the code read
// back out of the message, which also exercises the real issue/hash/consume
// path rather than reaching into the database and faking it.
vi.mock('../lib/email', () => ({ sendEmail: vi.fn(async () => {}) }))

const sendEmailMock = vi.mocked(sendEmail)

interface SentMail {
  to: string
  code: string
}

function lastMail(): SentMail {
  const call = sendEmailMock.mock.calls.at(-1)
  if (!call) throw new Error('no email was sent')
  const [params] = call
  const match = /\b(\d{6})\b/.exec(params.text)
  if (!match?.[1]) throw new Error(`no 6-digit code in: ${params.text}`)
  return { to: params.to, code: match[1] }
}

// signUp() itself mails a verification link, so "no mail was sent" is never
// true inside a test — what matters is that nothing reached the address under
// test.
function mailedTo(address: string): boolean {
  return sendEmailMock.mock.calls.some(([params]) => params.to === address)
}

beforeEach(() => {
  sendEmailMock.mockClear()
})

describe('POST /auth/change-email', () => {
  it('rejects a wrong password', async () => {
    const s = await signUp('password123')
    const res = await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'new@example.com', password: 'nope' })

    expect(res.status).toBe(401)
    expect(mailedTo('new@example.com')).toBe(false)
  })

  it('requires a password on a password account', async () => {
    const s = await signUp('password123')
    const res = await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'new@example.com' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('password_required')
  })

  it('refuses an address that is already in use', async () => {
    const mine = await signUp('password123')
    const theirs = await signUp('password123')

    const res = await request
      .post('/auth/change-email')
      .set('Authorization', auth(mine.accessToken))
      .send({ newEmail: theirs.email, password: 'password123' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('email_taken')
  })

  it('refuses a no-op change', async () => {
    const s = await signUp('password123')
    const res = await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: s.email, password: 'password123' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('email_unchanged')
  })

  it('mails the code to the NEW address, not the current one', async () => {
    const s = await signUp('password123')
    const res = await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'moved@example.com', password: 'password123' })

    expect(res.status).toBe(200)
    expect(res.body.user.pendingEmail).toBe('moved@example.com')
    // Crucially still the old address — nothing has changed yet.
    expect(res.body.user.email).toBe(s.email)
    expect(lastMail().to).toBe('moved@example.com')
  })
})

describe('POST /auth/change-email/confirm', () => {
  it('swaps the address, marks it verified, and clears the pending state', async () => {
    const s = await signUp('password123')
    await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'moved@example.com', password: 'password123' })

    const res = await request
      .post('/auth/change-email/confirm')
      .set('Authorization', auth(s.accessToken))
      .send({ code: lastMail().code })

    expect(res.status).toBe(200)
    expect(res.body.user.email).toBe('moved@example.com')
    expect(res.body.user.pendingEmail).toBeUndefined()
    expect(res.body.user.emailVerifiedAt).toBeTruthy()

    // And the new address is what signs in now.
    const signIn = await request
      .post('/auth/signin')
      .send({ email: 'moved@example.com', password: 'password123' })
    expect(signIn.status).toBe(200)
  })

  it('rejects a wrong code and does not change the address', async () => {
    const s = await signUp('password123')
    await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'moved@example.com', password: 'password123' })

    const res = await request
      .post('/auth/change-email/confirm')
      .set('Authorization', auth(s.accessToken))
      .send({ code: '000000' })

    expect(res.status).toBe(400)
    const me = await request.get('/auth/me').set('Authorization', auth(s.accessToken))
    expect(me.body.user.email).toBe(s.email)
  })

  it('refuses to reuse a code', async () => {
    const s = await signUp('password123')
    await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'moved@example.com', password: 'password123' })
    const { code } = lastMail()

    const first = await request
      .post('/auth/change-email/confirm')
      .set('Authorization', auth(s.accessToken))
      .send({ code })
    expect(first.status).toBe(200)

    const second = await request
      .post('/auth/change-email/confirm')
      .set('Authorization', auth(s.accessToken))
      .send({ code })
    expect(second.status).toBe(400)
  })

  it("will not accept another account's code", async () => {
    const victim = await signUp('password123')
    const attacker = await signUp('password123')

    // Victim requests a move; attacker learns the six digits somehow.
    await request
      .post('/auth/change-email')
      .set('Authorization', auth(victim.accessToken))
      .send({ newEmail: 'victim-new@example.com', password: 'password123' })
    const { code } = lastMail()

    await request
      .post('/auth/change-email')
      .set('Authorization', auth(attacker.accessToken))
      .send({ newEmail: 'attacker-new@example.com', password: 'password123' })

    const res = await request
      .post('/auth/change-email/confirm')
      .set('Authorization', auth(attacker.accessToken))
      .send({ code })

    // The hash is salted with the userId, so the digits are inert here.
    expect(res.status).toBe(400)
  })

  it('errors when nothing is pending', async () => {
    const s = await signUp('password123')
    const res = await request
      .post('/auth/change-email/confirm')
      .set('Authorization', auth(s.accessToken))
      .send({ code: '123456' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('no_pending_email')
  })

  it('keeps this session and revokes the others', async () => {
    const s = await signUp('password123')
    // A second device on the same account.
    const other = await request.post('/auth/signin').send({ email: s.email, password: 'password123' })
    const otherRefresh = other.body.tokens.refreshToken

    await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'moved@example.com', password: 'password123' })

    const confirmed = await request
      .post('/auth/change-email/confirm')
      .set('Authorization', auth(s.accessToken))
      .send({ code: lastMail().code, refreshToken: s.refreshToken })
    expect(confirmed.status).toBe(200)

    // Order matters, and not for style. Presenting a REVOKED refresh token trips
    // the reuse detector in rotateRefreshToken, which then revokes the whole
    // family for that user — so probing the dead session first would kill the
    // live one and make this assertion lie about which of the two survived.
    expect((await request.post('/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(200)
    expect((await request.post('/auth/refresh').send({ refreshToken: otherRefresh })).status).toBe(401)
  })
})

describe('DELETE /auth/change-email', () => {
  it('cancels a pending change', async () => {
    const s = await signUp('password123')
    await request
      .post('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
      .send({ newEmail: 'moved@example.com', password: 'password123' })

    const res = await request
      .delete('/auth/change-email')
      .set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(204)

    const me = await request.get('/auth/me').set('Authorization', auth(s.accessToken))
    expect(me.body.user.pendingEmail).toBeUndefined()
  })
})

describe('email verification by code', () => {
  it('sends a code and accepts it', async () => {
    const s = await signUp('password123')

    const sent = await request
      .post('/auth/verify-email/send-code')
      .set('Authorization', auth(s.accessToken))
    expect(sent.status).toBe(204)

    const mail = lastMail()
    expect(mail.to).toBe(s.email)

    const res = await request
      .post('/auth/verify-email/confirm-code')
      .set('Authorization', auth(s.accessToken))
      .send({ code: mail.code })

    expect(res.status).toBe(200)
    expect(res.body.user.emailVerifiedAt).toBeTruthy()
  })

  it('rejects a wrong code', async () => {
    const s = await signUp('password123')
    await request.post('/auth/verify-email/send-code').set('Authorization', auth(s.accessToken))

    const res = await request
      .post('/auth/verify-email/confirm-code')
      .set('Authorization', auth(s.accessToken))
      .send({ code: '000000' })
    expect(res.status).toBe(400)
  })

  it('invalidates the previous code when a new one is sent', async () => {
    const s = await signUp('password123')
    await request.post('/auth/verify-email/send-code').set('Authorization', auth(s.accessToken))
    const first = lastMail().code

    await request.post('/auth/verify-email/send-code').set('Authorization', auth(s.accessToken))
    const second = lastMail().code

    // Resending must REPLACE, not accumulate — otherwise every resend widens
    // the guessing surface instead of refreshing it.
    expect(first).not.toBe(second)
    const stale = await request
      .post('/auth/verify-email/confirm-code')
      .set('Authorization', auth(s.accessToken))
      .send({ code: first })
    expect(stale.status).toBe(400)
  })

  it('is a no-op once already verified', async () => {
    const s = await signUp('password123')
    await request.post('/auth/verify-email/send-code').set('Authorization', auth(s.accessToken))
    await request
      .post('/auth/verify-email/confirm-code')
      .set('Authorization', auth(s.accessToken))
      .send({ code: lastMail().code })

    sendEmailMock.mockClear()
    const again = await request
      .post('/auth/verify-email/send-code')
      .set('Authorization', auth(s.accessToken))
    expect(again.status).toBe(204)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers', async () => {
    expect((await request.post('/auth/verify-email/send-code')).status).toBe(401)
    expect((await request.post('/auth/change-email').send({ newEmail: 'a@b.com' })).status).toBe(401)
  })
})
