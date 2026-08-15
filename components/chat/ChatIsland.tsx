'use client'

import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'

import chatbotImg from '@/assets/ghost/logo.png'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'
import { isAppChatRoute } from '@/lib/appRoutes'
import { BACKDROP_BLUR_FADE, BACKDROP_BLUR_STYLE } from '@/lib/motion-backdrop'
import { useMorphColors } from '@/lib/motion-colors'
import { env } from '@/lib/env'

// The chatbot — the bridge to the assistant. A mascot medallion FAB (with an
// explicit "Ask <app name>" label so the affordance is unmistakable)
// morphs (Dynamic Island engine) into a chat panel wired to the live AI
// backend: streamed replies, task tools with destructive confirmation, voice.
// Mounted once in Providers, as a sibling of the route slot, so it decides for
// itself where it belongs: signed-in app surfaces only, never the auth /
// onboarding screens, which run their own morphing island. Gating out here
// (rather than inside the surface) also unmounts the panel on the way out, so
// an open conversation can't spring back when the next app route mounts.
export function ChatIsland() {
  const pathname = usePathname()
  if (!isAppChatRoute(pathname)) return null
  return <ChatIslandSurface />
}

function ChatIslandSurface() {
  const t = useTranslations('chat')
  const [open, setOpen] = useState(false)
  const state: 'fab' | 'panel' = open ? 'panel' : 'fab'
  const { accent, surface } = useMorphColors()
  const shapes: Record<'fab' | 'panel', MorphShape> = useMemo(
    () => ({
      fab: { width: 50, height: 50, radius: 32, background: accent },
      panel: { width: 330, height: 620, radius: 24, background: surface },
    }),
    [accent, surface],
  )

  return (
    <>
      {/* Backdrop — a soft blur + dim behind the expanded island (chat or
          in-panel voice). Tapping it dismisses the panel.

          The frost lands in ~70ms, NOT on the island's ~280ms spring: measured
          against the real iOS launch animation the blur is ~92% of full
          strength by 68ms, so the scrim is already frosted while the FAB is
          still growing into a panel. See lib/motion-backdrop.ts. */}
      <AnimatePresence>
        {open ? (
          <motion.div
            key="chat-backdrop"
            variants={BACKDROP_BLUR_FADE}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => setOpen(false)}
            aria-hidden
            // See VoiceIsland's backdrop: compositing hint only, so the
            // fullscreen blur rasterizes once instead of every frame.
            style={BACKDROP_BLUR_STYLE}
            className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-md"
          />
        ) : null}
      </AnimatePresence>

      <div className="fixed bottom-24 end-3 z-40 flex items-center gap-2.5">
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-pill bg-surface px-3.5 py-2 text-label uppercase text-ink shadow-elevated transition-colors hover:bg-surface-sunken"
          >
            {t('ask', { app: env.appName })}
          </button>
        ) : null}
      <MorphSurface
        state={state}
        shapes={shapes}
        onClick={open ? undefined : () => setOpen(true)}
        role={open ? 'dialog' : 'button'}
        aria-label={
          open ? t('assistant', { app: env.appName }) : t('ask', { app: env.appName })
        }
        className={`shadow-2xl ${open ? '' : 'cursor-pointer ring-2 ring-accent/40'}`}
      >
        {state === 'fab' ? (
          <div className="relative grid h-full w-full place-items-center">
            {/* object-contain, not cover: the mascot is a tall silhouette on a
                transparent field, and cover crops its head off inside the FAB. */}
            <Image
              src={chatbotImg}
              alt=""
              fill
              sizes="50px"
              className="scale-95 object-contain"
              priority
            />
          </div>
        ) : (
          <ChatPanel onClose={() => setOpen(false)} />
        )}
      </MorphSurface>
      </div>
    </>
  )
}
