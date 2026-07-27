import supertest from 'supertest'
import { createApp } from '../app'

export const app = createApp()
export const request = supertest(app)

export interface TestSession {
  userId: string
  email: string
  accessToken: string
  refreshToken: string
}

let counter = 0

// Create a fresh password account and return its tokens. Each call uses a
// unique email so callers don't collide within a file.
export async function signUp(password = 'password123'): Promise<TestSession> {
  const email = `user${counter++}-${Date.now()}@example.com`
  const res = await request.post('/auth/signup').send({ email, password })
  if (res.status !== 201) {
    throw new Error(`signUp failed: ${res.status} ${JSON.stringify(res.body)}`)
  }
  return {
    userId: res.body.user.id,
    email,
    accessToken: res.body.tokens.accessToken,
    refreshToken: res.body.tokens.refreshToken,
  }
}

export function auth(token: string): string {
  return `Bearer ${token}`
}
