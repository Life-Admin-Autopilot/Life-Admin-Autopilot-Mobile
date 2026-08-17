import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api/client'
import type { Task } from '@/queries/tasks'

export interface FinancialInsights {
  overdueCount: number
  nearTermCount: number
  undatedCount: number
  urgentCount: number
  overdueTasks: Task[]
  nearTermTasks: Task[]
  undatedTasks: Task[]
  urgentTasks: Task[]
}

export function useFinancialInsights() {
  return useQuery<FinancialInsights>({
    queryKey: ['tasks', 'financial-insights'],
    queryFn: async () => {
      return api<FinancialInsights>('/me/financial-insights')
    },
    staleTime: 30_000, // 30 seconds stale time
  })
}
