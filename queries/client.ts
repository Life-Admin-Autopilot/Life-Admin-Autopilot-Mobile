// TanStack Query client factory. One client per app instance, created on the
// client in app/providers.tsx (the app is a static-export SPA — no server
// prefetch). Defaults encode v1's freshness lessons: refetch on window focus so
// a surface that was left open updates when the user returns (docs/LESSONS.md
// #8), with a short staleTime to avoid refetch storms.

import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  })
}
