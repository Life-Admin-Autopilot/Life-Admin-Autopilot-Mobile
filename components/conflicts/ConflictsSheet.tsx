'use client'

import { CalendarCheck2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { ConflictRow } from '@/components/conflicts/ConflictRow'
import { MorphSheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/button'
import { useAllConflicts } from '@/queries/planning'

/**
 * Every clash in the account, in one place.
 *
 * The four capture surfaces each announce a clash at the moment they cause one —
 * a chat card, a voice pop-up, a warning in the create sheet, a notice on the
 * matter itself. All four are moments, and a moment can be missed: a pop-up
 * fades, a card scrolls away, a scan is reviewed in a hurry. This is where the
 * clash waits afterwards, so no surface has to be the only chance to see it.
 *
 * It knows nothing about voice, chat, scans or manual creation, and it should
 * not. A conflict is two saved matters wanting the same time — the server
 * recomputes that on every open, so a clash from any source appears here and one
 * resolved anywhere disappears from here.
 *
 * A sheet rather than a route, because it is opened from the dashboard and
 * returns to it. It grows out of the row that opened it like every other sheet.
 *
 * <b>Nothing here can be dismissed.</b> An earlier version let a clash be kept,
 * which meant the list had to remember decisions — and it remembered them in one
 * place while the dashboard counted from another, so keeping every clash emptied
 * this sheet and left the dashboard still showing all of them. A list of facts
 * has no such failure mode: every surface asks the same question and gets the
 * same answer, and a clash leaves when its times stop overlapping.
 */
export function ConflictsSheet({
  open,
  onClose,
  trigger,
  onOpenMatter,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  onOpenMatter: (taskId: string) => void
}) {
  const t = useTranslations('dashboard.conflicts')
  const { data, isPending, error, refetch } = useAllConflicts()

  // Straight through, with no local filtering of any kind — see the note above.
  const rows = data ?? []

  return (
    <MorphSheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      title={t('title')}
      eyebrow={t('eyebrow')}
      height={480}
    >
      {isPending ? <Skeleton /> : null}

      {error ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-body-sm text-ink">{t('errorTitle')}</p>
          <Button variant="solid" onClick={() => void refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : null}

      {!isPending && !error && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <CalendarCheck2 size={28} strokeWidth={1.75} className="text-ink-subtle" />
          <p className="text-heading-sm text-ink">{t('emptyTitle')}</p>
          <p className="max-w-60 text-body-sm text-ink-muted">{t('emptyBody')}</p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2 py-1">
          {rows.map((conflict) => (
            <ConflictRow
              // The pair, not either matter: the same matter can appear in two
              // rows against two different neighbours, and keying on one side
              // would collapse them into one.
              key={`${conflict.a.taskId}:${conflict.b.taskId}`}
              conflict={conflict}
              onOpenMatter={(taskId) => {
                onClose()
                onOpenMatter(taskId)
              }}
            />
          ))}
        </ul>
      ) : null}
    </MorphSheet>
  )
}

/** Three rows at the real shape — not a spinner. */
function Skeleton() {
  return (
    <ul className="flex flex-col gap-2 py-1">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5 shadow-card">
          <div className="h-3.5 w-40 animate-pulse rounded-pill bg-surface-field" />
          <div className="h-3 w-24 animate-pulse rounded-pill bg-surface-field" />
          <div className="h-3.5 w-36 animate-pulse rounded-pill bg-surface-field" />
        </li>
      ))}
    </ul>
  )
}
