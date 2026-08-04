'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pill } from '@/components/ui/Pill'
import { ChoiceChip } from '@/components/onboarding/QuestionChips'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'
import {
  OriginalRequest,
  UncertaintyCard,
  type MeasureFn,
} from '@/components/uncertainty/UncertaintyCard'
import {
  useClarifications,
  useResolveClarification,
  useDeferClarification,
  useDropClarification,
  type Clarification,
} from '@/queries/clarifications'

// The card is a fixed-width island, and 348 is the width it wants. On a phone
// it can't have it: 348 plus the page's 24px gutters needs a 396px viewport,
// and an iPhone SE/12/13 mini is 375. The shell overflowed the centred grid on
// BOTH sides — the page scrolled sideways and the card's edges sat off-screen.
// Below that threshold the island simply takes the width it's given.
const MAX_WIDTH = 348
const GUTTER = 24

// First-frame heights only. Every card measures itself on mount (UncertaintyCard)
// and the shell springs to the real number; these just decide what the first
// paint is springing FROM, so a card is never born at height 0.
const INITIAL_HEIGHT = 300
const DONE_HEIGHT = 236

function localTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * The island's width, clamped to what the viewport can actually hold.
 *
 * Starts at MAX_WIDTH rather than measuring during render: the walker only
 * mounts after the list resolves client-side, so there is no server render to
 * disagree with, and the effect corrects the width before the first paint the
 * user sees. Tracks resize because a phone rotation changes the answer.
 */
function useIslandWidth(): number {
  const [width, setWidth] = useState(MAX_WIDTH)

  useEffect(() => {
    const read = () => setWidth(Math.min(MAX_WIDTH, window.innerWidth - GUTTER * 2))
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [])

  return width
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
  const width = useIslandWidth()

  const [queue] = useState(initial)
  const [index, setIndex] = useState(0)
  const [showCustom, setShowCustom] = useState(false)
  const [custom, setCustom] = useState('')
  const [measured, setMeasured] = useState<Record<string, number>>({})

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

  const onMeasure = useCallback<MeasureFn>((state, height) => {
    setMeasured((m) => (m[state] === height ? m : { ...m, [state]: height }))
  }, [])

  const typing = !done && (showCustom || current!.kind === 'detail')
  // Toggling between chips and the input changes the pane's height, and the
  // measurement for the new content lands a frame later — so the shape key has
  // to distinguish them. Keyed on the id alone, the shell kept the height of
  // whichever mode was measured last and clipped the other.
  const shapeKey = done ? 'done' : `${current!.id}:${typing ? 'typing' : 'options'}`
  const shapes = useMemo<Record<string, MorphShape>>(
    () => ({
      [shapeKey]: {
        width,
        height: measured[shapeKey] ?? (done ? DONE_HEIGHT : INITIAL_HEIGHT),
        radius: 30,
      },
    }),
    [shapeKey, width, measured, done],
  )

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-8">
      <MorphSurface state={shapeKey} shapes={shapes}>
        {done ? (
          // Closing the loop earns the celebration surface — one of the four
          // places gradient is allowed to appear.
          <UncertaintyCard
            state={shapeKey}
            onMeasure={onMeasure}
            className="bg-celebrate-gradient items-center justify-center gap-2 text-center"
          >
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
          </UncertaintyCard>
        ) : (
          <UncertaintyCard state={shapeKey} onMeasure={onMeasure}>
            <div className="flex items-center justify-between gap-3">
              {/* "Already filed", not "needs your input" — the task exists
                  either way, so this is an optional correction, not a demand. */}
              <Pill tone="accent" uppercase>
                {t('filedWithGuess')}
              </Pill>
              {/* One message, not "{n}" + "/" + "{n}" in JSX: Arabic reads the
                  counter as "3 من 12", and a slash assembled in markup cannot
                  become a word. */}
              <span className="shrink-0 text-body-sm tabular text-ink-muted">
                {t('position', { current: index + 1, total: queue.length })}
              </span>
            </div>
            <p className="mt-3 truncate text-body-sm text-ink-muted">{current!.draft.title}</p>
            <h2 className="mt-1 text-pretty font-display text-heading-serif text-ink">
              {current!.question}
            </h2>

            {current!.sourceText ? <OriginalRequest text={current!.sourceText} /> : null}

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

            <div className="mt-5 flex items-center justify-between gap-2">
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
              <div className="flex shrink-0 gap-1">
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
          </UncertaintyCard>
        )}
      </MorphSurface>
    </main>
  )
}
