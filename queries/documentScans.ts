// Document-scan pipeline: upload a camera photo / PDF, poll while it processes,
// then confirm/edit/discard the extracted candidates into Tasks. Mirrors
// queries/notifications.ts's shape; upload itself goes through apiBinary
// (see lib/documentScan/uploadScan.ts) since it's a raw-bytes POST, not JSON.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

// Mirrors DOCUMENT_TYPES on the server. Drives the row's leading icon; see
// components/scan/DocumentTypeIcon.tsx for the glyph mapping.
export type ScanDocumentType =
  | 'bill'
  | 'statement'
  | 'letter'
  | 'form'
  | 'receipt'
  | 'insurance'
  | 'medical'
  | 'legal'
  | 'identity'
  | 'tax'
  | 'other'

export type ScanCandidateDomain = 'health' | 'home' | 'car' | 'finance' | 'family' | 'pets'
export type ScanCandidatePriority = 'low' | 'normal' | 'high' | 'urgent'
export type ScanCandidateConfidence = 'high' | 'medium' | 'low'

export interface ScanCandidate {
  key: string
  title: string
  domain: ScanCandidateDomain
  priority: ScanCandidatePriority
  confidence: ScanCandidateConfidence
  dueAt?: string
  notes?: string
  sourcePage?: number
  taskId?: string
}

export interface ScannedDocument {
  id: string
  mimeType: string
  sourceType: 'camera' | 'pdf' | 'gallery'
  pageCount: number
  byteSize: number
  status: 'pending' | 'processing' | 'ready_for_review' | 'failed'
  failureReason?: string
  /** Server-derived: this document failed AND still has retry budget left, so
   *  extraction can be re-run on the stored bytes. False on a healthy document
   *  and on one that has burned through its retries. */
  canRetry: boolean
  /** One-to-two-sentence AI overview, for the detail surfaces (review card,
   *  task overview) — not the list row. */
  documentSummary?: string
  /** Document kind, for the list row's leading icon. */
  documentType?: ScanDocumentType
  /** Short noun-phrase headline for the list row ("Electricity bill"). */
  documentTitle?: string
  /** One-line row description, written most-important-first so it survives
   *  truncation ("Due July 30 · $142.37"). */
  documentSubtitle?: string
  /** Who the document came from ("City Power"). */
  issuer?: string
  candidates: ScanCandidate[]
  reviewedAt?: string
  createdAt: string
  updatedAt: string
}

export function useScannedDocuments() {
  return useQuery({
    queryKey: queryKeys.documentScans,
    queryFn: () => api<{ scannedDocuments: ScannedDocument[] }>('/me/document-scans'),
    // Short poll only while something is still pending/processing — a scan
    // usually clears in well under a minute; this keeps the list live without
    // hammering the API once everything has settled.
    refetchInterval: (query) => {
      const docs = query.state.data?.scannedDocuments ?? []
      const active = docs.some((d) => d.status === 'pending' || d.status === 'processing')
      return active ? 4_000 : false
    },
  })
}

export interface DeleteScansResult {
  deleted: number
  failed: number
}

// Bulk delete is a client-side fan-out over the single-id endpoint — the server
// delete is idempotent, so a partial failure is safe to retry wholesale rather
// than needing a bulk transaction and an undo token like the matters bulk ops.
//
// There is no undo: deleting destroys the stored original, so there is nothing
// to restore. The caller confirms before invoking rather than offering a
// take-back afterwards.
//
// Settles every request before reporting, so one failure doesn't hide the
// deletions that did land — the count is what the caller tells the user.
export function useDeleteScannedDocuments() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]): Promise<DeleteScansResult> => {
      const results = await Promise.allSettled(
        ids.map((id) => api<void>(`/me/document-scans/${id}`, { method: 'DELETE' })),
      )
      const deleted = results.filter((r) => r.status === 'fulfilled').length
      return { deleted, failed: results.length - deleted }
    },
    onSettled: () => {
      // Invalidated even on failure: a partial success left the cache stale for
      // whichever ids did delete.
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentScans })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
    },
  })
}

// Re-run extraction on a document that failed, from the bytes the server
// already holds. Distinct from the capture-side retry in useCaptureSource:
// that one resends an upload that never landed, this one restarts processing
// on an upload that did.
//
// Invalidating is what advances the UI — the server flips the document back to
// `pending`, and the list query resumes its poll (it only polls while something
// is pending/processing), which walks the flow from 'error' back to
// 'processing' with no local phase state to keep in sync.
export function useReprocessScannedDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: string) =>
      api<{ scannedDocument: ScannedDocument }>(`/me/document-scans/${documentId}/reprocess`, {
        method: 'POST',
      }),
    onSuccess: ({ scannedDocument }) => {
      // Written into the cache from the response BEFORE invalidating. The
      // refetch alone would leave the document reading `failed` for a round
      // trip, so the error screen would sit there with a live "Try again"
      // button after the retry had already been accepted — long enough to tap
      // twice. Patching first flips the flow to 'processing' on the same tick.
      queryClient.setQueryData<{ scannedDocuments: ScannedDocument[] }>(
        queryKeys.documentScans,
        (prev) =>
          prev
            ? {
                scannedDocuments: prev.scannedDocuments.map((d) =>
                  d.id === scannedDocument.id ? scannedDocument : d,
                ),
              }
            : prev,
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentScans })
    },
  })
}

export interface ReviewAccept {
  key: string
  title?: string
  domain?: ScanCandidateDomain
  priority?: ScanCandidatePriority
  dueAt?: string
  notes?: string
}

// Minimal shape of a Task as returned by the review endpoint — just what the
// document flow's success screen needs, not a full frontend Task model (none
// exists yet; the dashboard still uses static placeholder data).
export interface ReviewedTask {
  id: string
  title: string
  domain: ScanCandidateDomain
  dueAt?: string
}

export interface ReviewScanResult {
  tasks: ReviewedTask[]
  scannedDocument: ScannedDocument
}

export function useReviewScannedDocument(documentId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { accepts: ReviewAccept[]; discards: string[] }) =>
      api<ReviewScanResult>(`/me/document-scans/${documentId}/review`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documentScans })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
    },
  })
}
