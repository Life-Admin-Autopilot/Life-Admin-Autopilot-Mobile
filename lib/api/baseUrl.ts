// Resolves the backend base URL for the API client.
//
// On web/Capacitor there is no Metro host to derive from (v1's RN concern), so
// this is just the explicit NEXT_PUBLIC_API_URL. When unset, return '' — the
// empty string makes requests fail fast and `envError` (lib/env.ts) surfaces
// the friendly "Setup needed" message.
//
// Lives in `lib/api/*` — the client seam — so platform reads are allowed here
// while `lib/env.ts` stays pure (AGENTS.md → Module boundaries).

import { env } from '@/lib/env'

export function resolveApiBaseUrl(): string {
  return env.apiUrl
}
