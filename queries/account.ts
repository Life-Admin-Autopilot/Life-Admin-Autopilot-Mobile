// Account-level actions: take your data out, or close the account entirely.
//
// Both are terminal in their own way, so neither is optimistic and neither
// retries. The delete deliberately clears the local session itself rather than
// waiting for the next 401 — the account is gone, so every token in memory is
// already worthless and leaving them there just means the next request fails
// somewhere confusing.

import { useMutation } from '@tanstack/react-query'

import { apiBlob, api } from '@/lib/api/client'
import { saveExport } from '@/lib/account/downloadExport'
import { useSessionStore } from '@/lib/auth/sessionStore'

export function useExportData() {
  return useMutation({
    mutationFn: async () => {
      const blob = await apiBlob('/me/export')
      return saveExport(await blob.text())
    },
  })
}

export interface DeleteAccountInput {
  /** Required for password accounts; magic-link-only accounts send nothing. */
  password?: string
}

export function useDeleteAccount() {
  const clear = useSessionStore((s) => s.clear)
  return useMutation({
    mutationFn: (body: DeleteAccountInput) => api<void>('/me', { method: 'DELETE', body }),
    onSuccess: async () => {
      await clear()
    },
  })
}
