import { env } from '../env'
import { logger } from '../logger'

export interface SendEmailParams {
  to: string
  subject: string
  html: string
  text: string
}

export async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = env().RESEND_API_KEY
  if (!apiKey) {
    logger.warn(
      {
        to: params.to,
        subject: params.subject,
        text: params.text,
      },
      'email:dev-log-only (no RESEND_API_KEY set)',
    )
    return
  }

  const { Resend } = await import('resend')
  const client = new Resend(apiKey)
  const result = await client.emails.send({
    from: env().EMAIL_FROM,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  })

  if (result.error) {
    logger.error({ err: result.error, to: params.to }, 'email:send-failed')
    throw new Error(`Email send failed: ${result.error.message}`)
  }

  logger.info({ to: params.to, id: result.data?.id }, 'email:sent')
}
