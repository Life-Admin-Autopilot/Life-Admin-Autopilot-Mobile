import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import { logger } from './logger'
import { errorHandler } from './middleware/errorHandler'
import { authEmailRouter } from './routes/auth.email'
import { authMagicRouter } from './routes/auth.magic'
import { authPasswordRouter } from './routes/auth.password'
import { authSessionRouter } from './routes/auth.session'
import { healthRouter } from './routes/health'
import { meRouter } from './routes/me'
import { meBillingRouter } from './routes/me.billing'
import { meIntegrationsRouter } from './routes/me.integrations'
import { meSubscriptionRouter } from './routes/me.subscription'
import { meTasksRouter } from './routes/me.tasks'
import { meVoiceNotesRouter } from './routes/me.voiceNotes'
import { meDocumentScansRouter } from './routes/me.documentScans'
import { meDeviceTokensRouter } from './routes/me.deviceTokens'
import { meClarificationsRouter } from './routes/me.clarifications'
import { meNotificationsRouter } from './routes/me.notifications'
import { aiRouter } from './modules/ai/routes'

// Explicit CORS allowlist from CORS_ORIGINS (comma-separated). Never reflect an
// arbitrary Origin while sending credentials — that combination lets any site
// drive authenticated requests. With no allowlist configured we deny all
// cross-origin requests rather than silently trusting everything.
function buildCorsOptions(): cors.CorsOptions {
  const allowlist = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  return {
    credentials: true,
    origin: (origin, callback) => {
      // Non-browser clients (mobile app, curl, server-to-server) send no Origin
      // header — allow those; the allowlist only gates real browser origins.
      if (!origin || allowlist.includes(origin)) {
        callback(null, true)
        return
      }
      callback(null, false)
    },
  }
}

export function createApp(): Express {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors(buildCorsOptions()))
  app.use(express.json({ limit: '256kb' }))
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  )

  app.use(healthRouter)
  app.use(authPasswordRouter)
  app.use(authSessionRouter)
  app.use(authEmailRouter)
  app.use(authMagicRouter)
  app.use(meRouter)
  app.use(meSubscriptionRouter)
  app.use(meBillingRouter)
  app.use(meIntegrationsRouter)
  app.use(meTasksRouter)
  app.use(meVoiceNotesRouter)
  app.use(meDocumentScansRouter)
  app.use(meDeviceTokensRouter)
  app.use(meClarificationsRouter)
  app.use(meNotificationsRouter)
  app.use(aiRouter)

  app.use(errorHandler)
  return app
}
