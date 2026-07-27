import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { afterAll, afterEach, beforeAll } from 'vitest'

// Static env must exist before any `env()` call. The Mongo URI is filled in
// once the in-memory server boots (beforeAll), which runs before any request.
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-0123456789-abcdefghij'
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-0123456789-abcdefghij'
process.env.JWT_ACCESS_TTL ??= '15m'
process.env.JWT_REFRESH_TTL ??= '30d'
process.env.LOG_LEVEL ??= 'fatal'
// Placeholder so the lazily-cached env() validates at import time. The real
// in-memory URI (set in beforeAll) is passed straight to mongoose.connect, so
// the cached placeholder is never actually used to connect.
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/placeholder'

let mongod: MongoMemoryServer

beforeAll(async () => {
  mongod = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongod.getUri()
  await mongoose.connect(process.env.MONGODB_URI)
})

afterEach(async () => {
  const { collections } = mongoose.connection
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})))
})

afterAll(async () => {
  await mongoose.disconnect()
  await mongod.stop()
})
