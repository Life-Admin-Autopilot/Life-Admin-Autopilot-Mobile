'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { PanelLeft, SquarePen, X } from 'lucide-react'

import { ChatComposer } from '@/components/chat/ChatComposer'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { ConversationDrawer } from '@/components/chat/ConversationDrawer'
import { MorphSheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MORPH_SPRING } from '@/lib/motion'
import { useAiThreads, useCreateThread, useDeleteThread, useRenameThread } from '@/queries/ai'
import { useActiveThreadStore } from '@/lib/ai/activeThreadStore'
import { useAskAi } from '@/queries/aiChat'
import { useVoiceRecorder } from '@/lib/ai/useVoiceRecorder'
import { micFailureMessage } from '@/lib/ai/micFailure'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { env } from '@/lib/env'
import type { AiThreadSummary } from '@/lib/ai/types'

// The expanded island: a transcript, a composer, and the conversation drawer
// laid over both. Split out of ChatIsland, which now owns only the FAB↔panel
// morph and where the island is allowed to appear.

export function ChatPanel({ onClose }: { onClose: () => void }) {
  const tLib = useTranslations('lib')
  const tVoice = useTranslations('voice')
  const tCommon = useTranslations('common')
  const t = useTranslations('chat')

  const {
    status,
    conversationId,
    messages,
    pending,
    pendingConfirm,
    error,
    failedQuestion,
    ask,
    retry,
    stop,
    confirm,
    isLoadingConversation,
  } = useAskAi()

  const threads = useAiThreads()
  const setActiveId = useActiveThreadStore((s) => s.setActiveId)
  const createThread = useCreateThread()
  const renameThread = useRenameThread()
  const deleteThread = useDeleteThread()

  const recorder = useVoiceRecorder()
  const [transcribing, setTranscribing] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [renaming, setRenaming] = useState<AiThreadSummary | null>(null)
  const [deleting, setDeleting] = useState<AiThreadSummary | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const isStreaming = status === 'streaming'
  const isRecording = recorder.phase === 'recording'
  const activeThread = threads.data?.find((thread) => thread.id === conversationId) ?? null

  // Autoscroll to the tail on any new content. Streaming now arrives token by
  // token, so this fires continuously through a turn — which is the point: the
  // answer stays pinned to the bottom while it is being written.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending, transcribing])

  const send = (text: string) => {
    if (isStreaming || transcribing) return
    void ask(text, timezone)
  }

  // Wrapped so an unusable mic reports itself — a bare start() leaves the
  // button looking like it simply did nothing.
  const startRecording = async () => {
    const failure = await recorder.start()
    if (failure) toast.error(micFailureMessage(failure, env.appName, tLib))
  }

  const stopAndSend = async () => {
    const blob = await recorder.stop()
    if (!blob) return
    setTranscribing(true)
    try {
      const text = await transcribeAudio(blob)
      if (text.trim()) void ask(text.trim(), timezone)
      else toast.info(tVoice('nothingCaptured'))
    } catch (err) {
      toast.error(translateBackendError(err, tVoice('transcribeFailed')))
    } finally {
      setTranscribing(false)
    }
  }

  // One list: committed messages plus the in-flight draft as the last item. The
  // draft keeps its index when it finalizes, so the bubble never remounts.
  const rendered = pending ? [...messages, pending] : messages
  const empty = messages.length === 0 && !pending && !isLoadingConversation

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-1 border-b border-border px-2.5 py-3">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t('threads.open')}
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>

        {/* The thread's own name, not the app's — with several conversations
            open, a header that always read "Kitto" would leave the user with no
            way to tell which one they are looking at. */}
        <span className="min-w-0 flex-1 truncate px-1 text-center text-body-sm text-ink" dir="auto">
          {activeThread?.title ?? env.appName}
        </span>

        <button
          type="button"
          onClick={() => createThread.mutate()}
          disabled={createThread.isPending}
          aria-label={t('threads.new')}
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
        >
          <SquarePen size={15} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('closeAssistant')}
          className="grid size-7 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
        {empty ? (
          <p className="m-auto max-w-[80%] text-center text-body-sm text-ink-subtle">
            {t('emptyThread')}
          </p>
        ) : null}

        {/* Render the in-flight draft as the LAST item of one list with stable
            index keys. When the draft finalizes (pending → committed message) it
            keeps the same index/key, so the bubble updates in place instead of
            remounting — no flicker, no momentary double. New turns animate in
            with the morph spring (the Dynamic Island "expand" feel). */}
        {rendered.map((m, i) => {
          const isPending = pending !== null && i === rendered.length - 1
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={MORPH_SPRING}
              style={{ transformOrigin: m.role === 'user' ? 'bottom right' : 'bottom left' }}
            >
              <ChatMessage
                message={m}
                streaming={isPending}
                onConfirm={(id) => void confirm(id, 'confirm')}
                onDecline={(id) => void confirm(id, 'decline')}
                onAnswer={(text) => send(text)}
                pendingConfirm={pendingConfirm}
              />
            </motion.div>
          )
        })}

        {transcribing ? <p className="text-caption text-ink-subtle">{t('transcribing')}</p> : null}

        {status === 'error' && error ? (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2">
            <span className="text-caption text-ink-muted">{error}</span>
            {failedQuestion ? (
              <button
                type="button"
                onClick={() => retry(timezone)}
                className="shrink-0 text-caption font-medium text-accent hover:underline"
              >
                {tCommon('retry')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ChatComposer
        onSend={send}
        onStop={() => void stop()}
        onStartRecording={() => void startRecording()}
        onStopRecording={() => void stopAndSend()}
        onDiscardRecording={() => void recorder.stop()}
        isStreaming={isStreaming}
        isTranscribing={transcribing}
        isRecording={isRecording}
        elapsedMs={recorder.elapsedMs}
      />

      <ConversationDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        threads={threads.data ?? []}
        isLoading={threads.isLoading}
        activeId={conversationId}
        onSelect={(id) => {
          setActiveId(id)
          setDrawerOpen(false)
        }}
        onNew={() => {
          createThread.mutate()
          setDrawerOpen(false)
        }}
        onRename={setRenaming}
        onDelete={setDeleting}
      />

      {renaming ? (
        <RenameSheet
          thread={renaming}
          onClose={() => setRenaming(null)}
          onSave={(title) => {
            renameThread.mutate({ id: renaming.id, title })
            setRenaming(null)
          }}
        />
      ) : null}

      {deleting ? (
        <MorphSheet
          open
          onClose={() => setDeleting(null)}
          title={t('threads.deleteTitle')}
          eyebrow={t('threads.deleteEyebrow')}
          eyebrowTone="danger"
          height={260}
          footer={
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setDeleting(null)}>
                {tCommon('cancel')}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  deleteThread.mutate(deleting.id)
                  setDeleting(null)
                }}
              >
                {t('threads.delete')}
              </Button>
            </div>
          }
        >
          <p className="text-body-sm text-ink-muted" dir="auto">
            {t('threads.deleteBody', {
              title: deleting.title ?? t('threads.untitled'),
            })}
          </p>
        </MorphSheet>
      ) : null}
    </div>
  )
}

function RenameSheet({
  thread,
  onClose,
  onSave,
}: {
  thread: AiThreadSummary
  onClose: () => void
  onSave: (title: string) => void
}) {
  const t = useTranslations('chat')
  const tCommon = useTranslations('common')
  // Draft state lives in the sheet, so an abandoned edit cannot leak back into
  // the list (AGENTS.md → Sheets).
  const [title, setTitle] = useState(thread.title ?? '')

  return (
    <MorphSheet
      open
      onClose={onClose}
      title={t('threads.renameTitle')}
      height={280}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="solid"
            className="flex-1"
            disabled={title.trim().length === 0}
            onClick={() => onSave(title.trim())}
          >
            {tCommon('save')}
          </Button>
        </div>
      }
    >
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-label={t('threads.renameLabel')}
        maxLength={80}
        dir="auto"
        autoFocus
      />
    </MorphSheet>
  )
}
