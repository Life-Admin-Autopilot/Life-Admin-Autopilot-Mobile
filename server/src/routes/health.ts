import { Router } from 'express'
import mongoose from 'mongoose'

export const healthRouter = Router()

const STATE_LABELS: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
}

healthRouter.get('/health', (_req, res) => {
  const dbState = mongoose.connection.readyState
  const dbReady = dbState === 1
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? 'ok' : 'degraded',
    db: STATE_LABELS[dbState] ?? 'unknown',
    uptime: process.uptime(),
  })
})
