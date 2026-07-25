// Document-scan pipeline: upload a camera photo / PDF, poll while it processes,
// then confirm/edit/discard the extracted candidates into Tasks. Mirrors
// queries/notifications.ts's shape; upload itself goes through apiBinary
// (see lib/documentScan/uploadScan.ts) since it's a raw-bytes POST, not JSON.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

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
  /** One-to-two-sentence AI overview of the document itself. */
  documentSummary?: string
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
