// Backend health probe. This is the foundation's end-to-end seam check: it
// exercises env → baseUrl → api client → CORS → Express with no auth. Real
// feature hooks key off queries/keys.ts (ported with the data layer in a later
// session); this dev probe inlines its key.

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'

export interface HealthResponse {
  status: 'ok' | 'degraded'
  db: 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'uninitialized' | 'unknown'
  uptime: number
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api<HealthResponse>('/health', { authenticated: false }),
    retry: false,
  })
}
