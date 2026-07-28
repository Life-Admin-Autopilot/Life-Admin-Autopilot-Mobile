// Plan and billing reads.
//
// Both endpoints are real and both are honest about being early: the tier is
// server-managed with no way to change it yet, and the invoice list is a
// deliberate stub returning `[]` until a payment provider exists. The UI
// renders the designed empty state from that shape rather than pretending a
// purchase flow is one tap away.

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import type { SubscriptionState } from '@/lib/auth/sessionStore'

interface SubscriptionResponse {
  subscription: SubscriptionState
}

export interface Invoice {
  id: string
  amountCents: number
  currency: string
  status: string
  issuedAt: string
  url?: string
}

interface InvoicesResponse {
  invoices: Invoice[]
}

export function useSubscription() {
  return useQuery({
    queryKey: queryKeys.subscription,
    queryFn: () => api<SubscriptionResponse>('/me/subscription'),
    staleTime: 60_000,
  })
}

export function useInvoices() {
  return useQuery({
    queryKey: queryKeys.invoices,
    queryFn: () => api<InvoicesResponse>('/me/billing/invoices'),
    staleTime: 60_000,
  })
}
