'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowLeft, CheckCircle, AlertCircle, Clock, FileText } from 'lucide-react'

import { AppHeader } from '@/components/layout/AppHeader'
import { MatterRow } from '@/components/dashboard/MatterRow'
import { MatterDetailSheet } from '@/components/matters/MatterDetailSheet'
import { useFinancialInsights } from '@/queries/financial-insights'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatDue, bucketOf } from '@/lib/taskFormat'
import { toast } from '@/lib/toast'
import { useUndoBulk, type Task } from '@/queries/tasks'

type TabType = 'overdue' | 'nearTerm' | 'urgent' | 'undated'

export default function FinancialInsightsPage() {
  const router = useRouter()
  const tProfile = useTranslations('profile')
  const tMatters = useTranslations('matters')
  const tCommon = useTranslations('common')
  const tag = useIntlTag()
  const now = new Date()
  const undoBulk = useUndoBulk()

  const { data, isPending, isError } = useFinancialInsights()

  const [activeTab, setActiveTab] = useState<TabType>('overdue')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)

  const overdueTasks = data?.overdueTasks ?? []
  const nearTermTasks = data?.nearTermTasks ?? []
  const urgentTasks = data?.urgentTasks ?? []
  const undatedTasks = data?.undatedTasks ?? []

  const activeTasks = 
    activeTab === 'overdue' ? overdueTasks :
    activeTab === 'nearTerm' ? nearTermTasks :
    activeTab === 'urgent' ? urgentTasks :
    undatedTasks

  const detail = detailId ? (
    overdueTasks.find((t) => t.id === detailId) ??
    nearTermTasks.find((t) => t.id === detailId) ??
    urgentTasks.find((t) => t.id === detailId) ??
    undatedTasks.find((t) => t.id === detailId) ??
    null
  ) : null

  return (
    <main className="min-h-dvh pb-32 bg-canvas">
      <AppHeader title={tProfile('rows.financialInsights')} />

      <div className="flex flex-col gap-6 px-5 pt-4">
        {/* Navigation & Back Action */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 self-start text-ink-muted hover:text-ink transition-colors"
        >
          <ArrowLeft size={18} />
          <span className="text-body-sm font-sans">{tCommon('back')}</span>
        </button>

        {isPending ? (
          <div className="flex flex-col items-center justify-center py-20 text-ink-muted">
            <span className="animate-pulse text-body-lg font-sans">{tMatters('summary.loading')}</span>
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-ink-muted">
            <span className="text-body-lg font-sans">{tMatters('summary.failed')}</span>
          </div>
        ) : (
          <>
            {/* 2x2 Grid of Metrics Cards */}
            <div className="grid grid-cols-2 gap-3.5">
              {/* Overdue */}
              <button
                type="button"
                onClick={() => setActiveTab('overdue')}
                className={`flex flex-col items-start gap-1.5 p-4 rounded-2xl bg-surface text-start shadow-card border-2 transition-all active:scale-[0.98] ${
                  activeTab === 'overdue'
                    ? 'border-danger bg-danger-sunken shadow-md'
                    : 'border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 text-danger">
                  <AlertCircle size={18} />
                  <span className="text-heading-sm font-sans">
                    {tMatters('bucket.overdue')}
                  </span>
                </div>
                <span className="font-display text-heading-serif text-ink">
                  {overdueTasks.length}
                </span>
              </button>

              {/* Near-Term (Due Soon) */}
              <button
                type="button"
                onClick={() => setActiveTab('nearTerm')}
                className={`flex flex-col items-start gap-1.5 p-4 rounded-2xl bg-surface text-start shadow-card border-2 transition-all active:scale-[0.98] ${
                  activeTab === 'nearTerm'
                    ? 'border-accent bg-accent-sunken shadow-md'
                    : 'border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 text-accent">
                  <Clock size={18} />
                  <span className="text-heading-sm font-sans">
                    {tMatters('section.due') || 'Due Soon'}
                  </span>
                </div>
                <span className="font-display text-heading-serif text-ink">
                  {nearTermTasks.length}
                </span>
              </button>

              {/* Urgent */}
              <button
                type="button"
                onClick={() => setActiveTab('urgent')}
                className={`flex flex-col items-start gap-1.5 p-4 rounded-2xl bg-surface text-start shadow-card border-2 transition-all active:scale-[0.98] ${
                  activeTab === 'urgent'
                    ? 'border-warning bg-warning-sunken shadow-md'
                    : 'border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 text-warning">
                  <CheckCircle size={18} />
                  <span className="text-heading-sm font-sans">
                    {tMatters('priority.urgent')}
                  </span>
                </div>
                <span className="font-display text-heading-serif text-ink">
                  {urgentTasks.length}
                </span>
              </button>

              {/* Undated */}
              <button
                type="button"
                onClick={() => setActiveTab('undated')}
                className={`flex flex-col items-start gap-1.5 p-4 rounded-2xl bg-surface text-start shadow-card border-2 transition-all active:scale-[0.98] ${
                  activeTab === 'undated'
                    ? 'border-ink bg-surface-sunken shadow-md'
                    : 'border-transparent'
                }`}
              >
                <div className="flex items-center gap-2 text-ink-muted">
                  <FileText size={18} />
                  <span className="text-heading-sm font-sans">
                    {tMatters('bucket.undated')}
                  </span>
                </div>
                <span className="font-display text-heading-serif text-ink">
                  {undatedTasks.length}
                </span>
              </button>
            </div>

            {/* Categorized Tasks List */}
            <div className="flex flex-col gap-3">
              <h2 className="text-label uppercase text-ink-muted font-sans pt-2">
                {activeTab === 'overdue' && tMatters('bucket.overdue')}
                {activeTab === 'nearTerm' && (tMatters('section.due') || 'Due Soon')}
                {activeTab === 'urgent' && tMatters('priority.urgent')}
                {activeTab === 'undated' && tMatters('bucket.undated')}
              </h2>

              {activeTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 rounded-2xl bg-surface shadow-card text-ink-muted text-center">
                  <span className="text-body-md font-sans">
                    {tMatters('summary.nothingScheduled')}
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {activeTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={(e) => {
                        setTriggerRect(e.currentTarget.getBoundingClientRect())
                        setDetailId(task.id)
                      }}
                      className="block w-full text-start"
                    >
                      <MatterRow
                        domain={task.domain}
                        title={task.title}
                        due={formatDue(task.dueAt, { t: tMatters, tag, now })}
                        overdue={bucketOf(task as Task, now) === 'overdue'}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <MatterDetailSheet
        task={detail as Task | null}
        trigger={triggerRect}
        onClose={() => setDetailId(null)}
        onDeleted={(token, title) => {
          if (!token) {
            toast.info(`Deleted ${title}`)
            return
          }
          toast.success(`Deleted ${title}`, {
            action: {
              label: 'Undo',
              onPress: () =>
                undoBulk.mutate(token, {
                  onSuccess: () => toast.info('Restored'),
                  onError: () => toast.error('Undo failed'),
                }),
            },
          })
        }}
      />
    </main>
  )
}
