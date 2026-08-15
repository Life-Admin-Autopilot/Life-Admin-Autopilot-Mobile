'use client'

import { useState } from 'react'

import { ChatComposer } from '@/components/chat/ChatComposer'

// Scratch preview for the chat composer at the island's real width (330px).
// Sibling of the other zz-preview-* routes; not linked from anywhere.
export default function ComposerPreview() {
  const [sent, setSent] = useState<string[]>([])
  const [streaming, setStreaming] = useState(false)

  return (
    <main className="flex min-h-screen items-center justify-center gap-6 bg-canvas p-8">
      <div className="w-[330px] overflow-hidden rounded-2xl bg-surface shadow-elevated">
        <div className="h-64 px-3.5 py-3">
          {sent.map((s, i) => (
            <p key={i} className="text-body-sm text-ink">
              {s}
            </p>
          ))}
        </div>
        <ChatComposer
          onSend={(text) => setSent((prev) => [...prev, text])}
          onStop={() => setStreaming(false)}
          onStartRecording={() => {}}
          onStopRecording={() => {}}
          onDiscardRecording={() => {}}
          isStreaming={streaming}
          isTranscribing={false}
          isRecording={false}
          elapsedMs={0}
        />
      </div>
      <button
        type="button"
        onClick={() => setStreaming((s) => !s)}
        className="rounded-pill bg-ink px-3 py-2 text-label text-canvas"
      >
        toggle streaming
      </button>
    </main>
  )
}
