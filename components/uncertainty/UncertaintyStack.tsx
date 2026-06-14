'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'
import {
  useClarifications,
  useResolveClarification,
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
  const { data, isLoading } = useClarifications()
  if (!data) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-body-sm text-ink-subtle">
        {isLoading ? 'Loading…' : ''}
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
  const router = useRouter()
  const resolve = useResolveClarification()
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
  const dropIt = () => {
    if (!current) return
    drop.mutate(current.id)
    advance()
  }

  const state = done ? 'done' : current!.id
  const typing = !done && (showCustom || current!.kind === 'detail')
  const optionCount = done ? 0 : Math.min(current!.options.length, 4)
  const height = done ? 200 : 244 + (typing ? 64 : optionCount * 50)
  const shapes: Record<string, MorphShape> = { [state]: { width: WIDTH, height, radius: 26 } }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <MorphSurface state={state} shapes={shapes}>
        {done ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
            <h2 className="font-display text-display-md text-ink">All clear.</h2>
            <p className="text-body text-ink-muted">Nothing else needs your call.</p>
            <Button className="mt-2 h-11 w-full" onClick={() => router.replace('/dashboard')}>
              Back to dashboard
            </Button>
          </div>
        ) : (
          <div className="flex h-full flex-col p-5">
            <div className="flex items-center justify-between">
              <span className="text-label uppercase text-accent">Needs your input</span>
              <span className="text-caption text-ink-subtle">
                {index + 1}/{queue.length}
              </span>
            </div>
            <p className="mt-1 truncate text-caption text-ink-subtle">{current!.draft.title}</p>
            <h2 className="mt-1 font-display text-heading-xl text-ink">{current!.question}</h2>

            {typing ? (
              <div className="mt-3 flex flex-col gap-2">
                <Input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCustom()
                  }}
                  autoFocus
                  placeholder="Type your answer…"
                  className="h-11"
                />
                <Button className="h-11 w-full" disabled={!custom.trim()} onClick={submitCustom}>
                  Save
                </Button>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {current!.options.map((o, i) => (
                  <button
                    key={i}
                    onClick={() => pickOption(i)}
                    className="rounded-pill border border-border bg-surface px-4 py-2 text-body-sm text-ink transition-colors hover:border-accent hover:bg-surface-sunken"
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between pt-3">
              {current!.kind !== 'detail' ? (
                <button onClick={() => setShowCustom((s) => !s)} className="text-caption text-accent">
                  {showCustom ? 'Pick an option' : 'Type your own'}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-4">
                <button onClick={advance} className="text-caption text-ink-subtle hover:text-ink">
                  Skip
                </button>
                <button onClick={dropIt} className="text-caption text-ink-subtle hover:text-danger">
                  Drop
                </button>
              </div>
            </div>
          </div>
        )}
      </MorphSurface>
    </main>
  )
}
