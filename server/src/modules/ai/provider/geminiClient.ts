import { GoogleGenAI } from '@google/genai'

import { env } from '../../../env'
import { AppError } from '../../../lib/errors'

// Singleton Gemini client. Lazily instantiated so a missing GEMINI_API_KEY
// only surfaces when the AI surface is actually invoked — the rest of the
// app boots cleanly without the key (same posture as Resend / voice
// transcriber). Mirrors Wiscord's `provider/gemini-client.ts`.

let cached: GoogleGenAI | null = null

export function isAiConfigured(): boolean {
  return Boolean(env().GEMINI_API_KEY)
}

export function getGeminiClient(): GoogleGenAI {
  const key = env().GEMINI_API_KEY
  if (!key) {
    throw new AppError(
      503,
      'ai_not_configured',
      'AI is not configured. Set GEMINI_API_KEY in server/.env to enable.',
    )
  }
  if (cached) return cached
  cached = new GoogleGenAI({ apiKey: key })
  return cached
}

// Test-only — lets tests reset the cached client between runs.
export function __resetGeminiClientForTests(): void {
  cached = null
}
