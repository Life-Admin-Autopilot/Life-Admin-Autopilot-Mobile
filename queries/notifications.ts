// In-app notification feed (reminders + uncertainty nudges). The dashboard bell
// reads the unread count; opening the panel marks them read. Light polling keeps
// the badge fresh while the app is open (real push lands with Capacitor later).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

export interface AppNotification {
  id: string
  kind: 'reminder' | 'uncertainty' | 'document_scan'
  title: string
  body?: string
  taskId?: string
  clarificationId?: string
  documentId?: string
  readAt?: string
  createdAt: string
}

interface NotificationsResponse {
  notifications: AppNotification[]
  unreadCount: number
}

export function useNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api<NotificationsResponse>('/me/notifications'),
    refetchInterval: 60_000,
  })
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api<{ ok: boolean; unreadCount: number }>('/me/notifications/read', {
        method: 'POST',
        body: ids ? { ids } : {},
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  })
}
