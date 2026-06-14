import mongoose from 'mongoose'
import { env } from './env'
import { logger } from './logger'

export async function connectDb(): Promise<void> {
  mongoose.connection.on('connected', () => {
    logger.info({ uri: redactUri(env().MONGODB_URI) }, 'mongo:connected')
  })
  mongoose.connection.on('disconnected', () => {
    logger.warn('mongo:disconnected')
  })
  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'mongo:error')
  })

  await mongoose.connect(env().MONGODB_URI, {
    serverSelectionTimeoutMS: 5_000,
  })
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect()
}

function redactUri(uri: string): string {
  return uri.replace(/\/\/[^@]+@/, '//<redacted>@')
}
