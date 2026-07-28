// Monthly document-scan allowance, for the plan card's usage meter.
//
// Read from the server rather than derived on the client: the limit lives in
// env (DOCUMENT_SCAN_QUOTA_FREE_MONTHLY / _PRO_MONTHLY) and is enforced by the
// same module that reports it, so the meter can never disagree with the gate
// that actually blocks an upload.

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import type { SubscriptionTier } from '@/lib/auth/sessionStore'

export interface QuotaStatus {
  limit: number
  used: number
  remaining: number
  /** ISO — when the bucket rolls over. */
  resetAt: string
}

interface ScanQuotaResponse {
  tier: SubscriptionTier
  quota: QuotaStatus & { kind: 'document_scan' }
}

export function useDocumentScanQuota() {
  return useQuery({
    queryKey: queryKeys.documentScanQuota,
    queryFn: () => api<ScanQuotaResponse>('/me/document-scans/quota'),
    staleTime: 60_000,
  })
}
