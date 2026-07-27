'use client'

import { ArrowRight, Loader2, Mic, Search, Square, X } from 'lucide-react'
import { useState } from 'react'

import { cn } from '@/lib/cn'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { useVoiceRecorder } from '@/lib/ai/useVoiceRecorder'
import { translateBackendError } from '@/lib/translateBackendError'
import { toast } from '@/lib/toast'
import { useSearchMatters, type SearchResult } from '@/queries/mattersAi'

// Search by describing the thing you half-remember.
//
// "there was a task about renewing something, next month" has no exact-match
// answer — "renewing" is not in the title, and "next month" is a date range the
// person hasn't worked out. So this does not filter and it does not build a
// query: it asks, and the matching matters come back ranked by relevance.
//
// Typing still narrows the list live as plain text, which is the right
// behaviour for "car" when you know the word. Submitting or speaking escalates
// to the real search.

export function MattersSearchBar({
  value,
  onValueChange,
  onSearched,
  onClear,
  searching,
  hasResults,
}: {
  value: string
  onValueChange: (v: string) => void
  onSearched: (result: SearchResult) => void
  onClear: () => void
  searching: boolean
  hasResults: boolean
}) {
  const search = useSearchMatters()
  const recorder = useVoiceRecorder()
  const [transcribing, setTranscribing] = useState(false)

  const recording = recorder.phase === 'recording'
  const busy = search.isPending || transcribing || searching

  const run = (query: string) => {
    const q = query.trim()
    if (!q) return
    search.mutate(q, {
      onSuccess: (res) => onSearched(res),
      onError: (err) => toast.error(translateBackendError(err, "Couldn't run that search.")),
    })
  }

  const toggleMic = async () => {
    if (!recording) {
      await recorder.start()
      return
    }
    const blob = await recorder.stop()
    if (!blob) {
      toast.info('Too short — nothing captured.')
      return
    }
    setTranscribing(true)
    try {
      const text = await transcribeAudio(blob)
      if (!text.trim()) {
        toast.info('Nothing was captured.')
        return
      }
      // Show what was heard before answering it — a wrong transcription is
      // otherwise indistinguishable from a wrong answer.
      onValueChange(text)
      run(text)
    } catch (err: unknown) {
      toast.error(translateBackendError(err, 'Could not transcribe that.'))
    } finally {
      setTranscribing(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(value)
      }}
      className={cn(
        'flex items-center gap-2.5 rounded-pill bg-surface-field px-4 py-2.5 transition-shadow',
        (recording || hasResults) && 'ring-2 ring-accent',
      )}
    >
      {busy ? (
        <Loader2 size={17} className="shrink-0 animate-spin text-accent" />
      ) : (
        <Search size={17} className="shrink-0 text-ink-muted" />
      )}

      <input
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={recording ? 'Listening…' : 'Describe what you’re looking for'}
        dir="auto"
        aria-label="Search matters"
        enterKeyHint="search"
        disabled={recording}
        className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
      />

      {value && !recording ? (
        <button
          type="button"
          onClick={() => {
            onValueChange('')
            onClear()
          }}
          aria-label="Clear search"
        >
          <X size={15} className="text-ink-subtle" />
        </button>
      ) : null}

      {/* Submit swaps in for the mic once there's something to ask. Enter works
          too, but a keyboard hint is not an affordance — with nothing visible to
          press, a typed question just sits there looking broken. */}
      {value.trim() && !recording ? (
        <button
          type="submit"
          disabled={busy}
          aria-label="Search"
          className="shrink-0 rounded-full bg-accent p-1 text-accent-ink transition-opacity disabled:opacity-40"
        >
          <ArrowRight size={16} />
        </button>
      ) : (
        <button
          type="button"
          onClick={toggleMic}
          disabled={busy && !recording}
          aria-label={recording ? 'Stop and search' : 'Search by voice'}
          className={cn(
            'shrink-0 rounded-full p-1 transition-colors disabled:opacity-40',
            recording ? 'bg-accent text-accent-ink' : 'text-accent hover:bg-accent-soft',
          )}
        >
          {recording ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
        </button>
      )}
    </form>
  )
}
