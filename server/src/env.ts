import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().min(1).default('onboarding@resend.dev'),

  APP_DEEP_LINK_SCHEME: z.string().default('lifeadmin'),

  VOICE_NOTE_STORAGE_DIR: z.string().optional(),
  VOICE_NOTE_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  // AI — optional so the app boots without a key. Surfaces in /ai/ask as
  // a 503 ai_not_configured when missing.
  //
  // Both model ids default to a REAL, currently-released Gemini model.
  // History: GEMINI_MODEL was pinned to 'gemini-2.0-flash' (an older,
  // weaker chat model) and GEMINI_STRONG_MODEL to 'gemini-3.5-flash' — an
  // id that DOES NOT EXIST, so every voice extraction silently 404'd
  // against the provider. Both now default to 'gemini-2.5-flash'. Override
  // per-env in server/.env if a newer id ships.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_STRONG_MODEL: z.string().default('gemini-2.5-flash'),
  AI_QUOTA_FREE_DAILY: z.coerce.number().int().positive().default(30),
  AI_QUOTA_PRO_DAILY: z.coerce.number().int().positive().default(300),
})

export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null
let loggedModels = false

export function env(): Env {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${formatted}`)
  }
  cached = parsed.data
  logResolvedModels(cached)
  return cached
}

// Surface the resolved Gemini model ids once at boot so an operator can see
// — in the server log — exactly which model is answering chat vs. running
// voice extraction. A wrong/non-existent id here is the root cause of "bad
// AI results", so make it observable. Lazy logger import dodges the
// env ↔ logger module cycle (logger.ts itself calls env()); a one-shot flag
// keeps it to a single line per process. Skipped under test to keep suites
// quiet and deterministic.
function logResolvedModels(resolved: Env): void {
  if (loggedModels) return
  loggedModels = true
  if (resolved.NODE_ENV === 'test') return
  void import('./logger')
    .then(({ logger }) => {
      logger.info(
        { model: resolved.GEMINI_MODEL, strongModel: resolved.GEMINI_STRONG_MODEL },
        'ai:models-resolved',
      )
    })
    .catch(() => {
      // Logger unavailable this early — non-fatal; boot proceeds.
    })
}

// Test-only — reset the env cache so a test can override process.env after
// initial boot. Production code never calls this.
export function __resetEnvForTests(): void {
  cached = null
  loggedModels = false
}
