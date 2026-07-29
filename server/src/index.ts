import 'dotenv/config'
import mongoose from 'mongoose'
import { createApp } from './app'
import { connectDb } from './db'
import { env } from './env'
import { logger } from './logger'
import { startVoiceWorker, stopVoiceWorker } from './lib/voiceNoteTranscriber'
import { startReminderWorker, stopReminderWorker } from './lib/reminderWorker'
import { startDocumentScanWorker, stopDocumentScanWorker } from './lib/documentScanWorker'
import { startIcsFeedWorker, stopIcsFeedWorker } from './lib/icsFeedWorker'
import { startGoogleSyncWorker, stopGoogleSyncWorker } from './lib/googleSyncWorker'

async function main(): Promise<void> {
  await connectDb()
  const app = createApp()
  const server = app.listen(env().PORT, () => {
    logger.info({ port: env().PORT }, 'server:listening')
  })

  // Background voice pipeline: claims pending notes + recovers crashed jobs.
  startVoiceWorker()
  // Background reminder scheduler: fires due reminders into the notification feed.
  startReminderWorker()
  // Background document-scan pipeline: claims pending scans + recovers crashed jobs.
  startDocumentScanWorker()
  // Background calendar-feed poller: conditional GETs, so a healthy feed costs
  // one round trip and no writes.
  startIcsFeedWorker()
  // Background Google poller: reconciles Calendar + Tasks. Not optional even
  // once watch channels land — they expire in ~7 days and fail silently.
  startGoogleSyncWorker()

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'server:shutting-down')
    stopVoiceWorker()
    stopReminderWorker()
    stopDocumentScanWorker()
    stopIcsFeedWorker()
    stopGoogleSyncWorker()
    server.close()
    await mongoose.disconnect()
    process.exit(0)
  }

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })
  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
}

main().catch((err) => {
  logger.fatal({ err }, 'server:start-failed')
  process.exit(1)
})
