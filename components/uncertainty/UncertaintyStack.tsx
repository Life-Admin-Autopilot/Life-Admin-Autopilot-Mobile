'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pill } from '@/components/ui/Pill'
import { ChoiceChip } from '@/components/onboarding/QuestionChips'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'
import {
  useClarifications,
  useResolveClarification,
  useDeferClarification,
  useDropClarification,
  type Clarification,
} from '@/queries/clarifications'

const WIDTH = 348

function localTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

// Gate on the loaded list, then hand the snapshot to the walker as a prop so it
// captures it once via initial state (no effect, no ref-in-render).
export function UncertaintyStack() {
  const t = useTranslations('uncertainty')
  const { data, isLoading } = useClarifications()
  if (!data) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-body-sm text-ink-subtle">
        {isLoading ? t('loading') : ''}
      </main>
    )
  }
  return <Walker initial={data.clarifications} />
}

// The fast fill-everything stack: one held item per morph card, resolved by an
// answer chip (no AI) or a typed answer (one bounded server-side interpret).
// Resolving morphs to the next card. The queue is snapshotted at mount so
// optimistic removals don't reshuffle the walk.
function Walker({ initial }: { initial: Clarification[] }) {
  const t = useTranslations('uncertainty')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const resolve = useResolveClarification()
  const defer = useDeferClarification()
  const drop = useDropClarification()

  const [queue] = useState(initial)
  const [index, setIndex] = useState(0)
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState('')

  const done = index >= queue.length
  const current = done ? null : (queue[index] ?? null)

  const advance = () => {
    setShowCustom(false)
    setCustom('')
    setIndex((i) => i + 1)
  }
  const pickOption = (i: number) => {
    if (!current) return
    resolve.mutate({ id: current.id, answer: { type: 'option', index: i }, timezone: localTz() })
    advance()
  }
  const submitCustom = () => {
    if (!current || !custom.trim()) return
    resolve.mutate({ id: current.id, answer: { type: 'custom', text: custom.trim() }, timezone: localTz() })
    advance()
  }
  // Skip is a real dismissal, not just a local index bump — tell the server so
  // the same question doesn't greet the user again next session.
  const skip = () => {
    if (!current) return
    defer.mutate(current.id)
    advance()
  }
  const dropIt = () => {
    if (!current) return
    drop.mutate(current.id)
    advance()
  }

  const state = done ? 'done' : current!.id
  const typing = !done && (showCustom || current!.kind === 'detail')
  const optionCount = done ? 0 : Math.min(current!.options.length, 4)
  const height = done ? 236 : 262 + (typing ? 76 : optionCount * 52)
  const shapes: Record<string, MorphShape> = { [state]: { width: WIDTH, height, radius: 30 } }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <MorphSurface state={state} shapes={shapes}>
        {done ? (
          // Closing the loop earns the celebration surface — one of the four
          // places gradient is allowed to appear.
          <div className="bg-celebrate-gradient flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <span aria-hidden className="text-[34px] leading-none">
              🌤️
            </span>
            <h2 className="font-display-wonk font-display text-display-md text-ink">
              {t('allClearTitle')}
            </h2>
            <p className="text-body text-ink-muted">{t('allClearBody')}</p>
            <Button
              variant="solid"
              className="mt-3 w-full"
              onClick={() => router.replace('/dashboard')}
            >
              {t('backToDashboard')}
            </Button>
          </div>
        ) : (
          <div className="flex h-full flex-col p-6">
            <div className="flex items-center justify-between">
              {/* "Already filed", not "needs your input" — the task exists
                  either way, so this is an optional correction, not a demand. */}
              <Pill tone="accent" uppercase>
                {t('filedWithGuess')}
              </Pill>
              {/* One message, not "{n}" + "/" + "{n}" in JSX: Arabic reads the
                  counter as "3 من 12", and a slash assembled in markup cannot
                  become a word. */}
              <span className="text-body-sm tabular text-ink-muted">
                {t('position', { current: index + 1, total: queue.length })}
              </span>
            </div>
            <p className="mt-3 truncate text-body-sm text-ink-muted">{current!.draft.title}</p>
            <h2 className="mt-1 font-display text-heading-serif text-ink">{current!.question}</h2>

            {typing ? (
              <div className="mt-4 flex flex-col gap-2.5">
                <Input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCustom()
                  }}
                  autoFocus
                  placeholder={t('answerPlaceholder')}
                />
                <Button
                  variant="accent"
                  className="w-full"
                  disabled={!custom.trim()}
                  onClick={submitCustom}
                >
                  {tCommon('save')}
                </Button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {current!.options.map((o, i) => (
                  <ChoiceChip key={i} label={o.label} onClick={() => pickOption(i)} />
                ))}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between pt-4">
              {current!.kind !== 'detail' ? (
                <button
                  onClick={() => setShowCustom((s) => !s)}
                  className="rounded-pill px-2 py-1 text-body-sm font-bold text-accent hover:bg-accent-soft"
                >
                  {showCustom ? t('pickOption') : t('typeYourOwn')}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-1">
                <button
                  onClick={skip}
                  className="rounded-pill px-2 py-1 text-body-sm text-ink-muted hover:text-ink"
                >
                  {tCommon('skip')}
                </button>
                <button
                  onClick={dropIt}
                  className="rounded-pill px-2 py-1 text-body-sm text-ink-muted hover:text-danger"
                >
                  {t('drop')}
                </button>
              </div>
            </div>
          </div>
        )}
      </MorphSurface>
    </main>
  )
}
