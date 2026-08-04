'use client'

// The document flow's full-page animated shell — one continuous "Dynamic
// Island" morph from a captured trigger DOMRect, through a bottom sheet, to
// fullscreen, hosting capture -> upload -> processing -> review -> success as
// a single surface rather than separate screens. Same physics as every other
// morph surface in the app (MORPH_SPRING/MORPH_CONTENT_VARIANTS, lib/motion.ts
// — do NOT retune); the only new technique is chaining THREE shape keyframes
// (trigger rect -> sheet -> fullscreen) by retargeting `animate` per phase,
// the same idiom MorphSurface already uses when its `state` prop changes.
//
// Phase is DERIVED, not hand-driven: only `activeDocId`/`minDwellDone`/
// `reviewResult` are real local state; everything else falls out of the
// shared useScannedDocuments() list this already receives as `docs`, so a
// background poll advancing a doc's status automatically advances the phase
// on the next render — no effect needed to "notice" the transition.

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { SketchCameraGlyph, SketchCheckGlyph, SketchUploadGlyph } from '@/components/icons/sketch/flowGlyphs'
import { ScanningDocumentGlyph } from '@/components/icons/sketch/ScanningDocumentGlyph'
import { ScanReviewCard } from '@/components/scan/ScanReviewCard'
import { TaskOverview } from '@/components/scan/TaskOverview'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useCaptureSource, type UseCaptureSourceResult } from '@/lib/documentScan/useCaptureSource'
import { env } from '@/lib/env'
import { useMorphColors } from '@/lib/motion-colors'
import { BACKDROP_BLUR_FADE, BACKDROP_BLUR_STYLE } from '@/lib/motion-backdrop'
import { MORPH_CONTENT_VARIANTS, MORPH_SPRING } from '@/lib/motion'
import { useBodyScrollLock } from '@/lib/scrollLock'
import { useReprocessScannedDocument } from '@/queries/documentScans'
import type { ReviewScanResult, ScannedDocument } from '@/queries/documentScans'

// `id` is the open's identity, not data — the host keys the flow by it so each
// open mounts a fresh instance instead of inheriting the last one's state.
export type DocumentCaptureTrigger =
  | { id: number; rect: DOMRect; mode: 'capture'; originColor?: string }
  | { id: number; rect: DOMRect; mode: 'open'; documentId: string; originColor?: string }

type Phase =
  | 'choose'
  | 'uploading'
  | 'uploadFailed'
  | 'processing'
  | 'review'
  | 'filed'
  | 'success'
  | 'error'

// Phases that stay in the bottom sheet. Everything else goes fullscreen. Kept
// as a list rather than a chain of `!==` so adding a phase can't silently
// inherit the wrong shape.
const SHEET_PHASES: readonly Phase[] = ['choose', 'uploading', 'uploadFailed']

const SHEET_HEIGHT = 300
const SHEET_MARGIN_BOTTOM = 20
const SHEET_RADIUS = 26

// Padding for the FULLSCREEN phases. Resolved in CSS rather than JS so it
// tracks orientation changes without a re-render, and falls back to the plain
// design values (30/24) on any surface without insets — desktop, or iOS before
// the safe-area vars resolve.
const CONTENT_INSET = {
  top: 'max(30px, calc(var(--safe-top) + 12px))',
  bottom: 'max(24px, calc(var(--safe-bottom) + 8px))',
} as const

interface DocumentCaptureFlowProps {
  docs: ScannedDocument[]
  trigger: DocumentCaptureTrigger
  onClose: () => void
}

export function DocumentCaptureFlow({ docs, trigger, onClose }: DocumentCaptureFlowProps) {
  const t = useTranslations('scan')
  const tCommon = useTranslations('common')
  const reduced = useReducedMotion()
  // The parent's AnimatePresence flips this to false the moment a dismissal
  // starts. The backdrop needs it explicitly: a nested AnimatePresence
  // republishes `isPresent: true` to its own children, so the backdrop never
  // hears that the flow is leaving and would otherwise sit at full opacity
  // until the shell's spring settles and the subtree is torn out — the dim
  // vanishing in one frame at the end. Gating on it lets the backdrop's fade
  // start on the same frame as the shell's collapse.
  const isPresent = useIsPresent()
  const { surface, canvas } = useMorphColors()
  const [vp] = useState(() => ({
    w: typeof window === 'undefined' ? 400 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))

  const [activeDocId, setActiveDocId] = useState<string | null>(
    trigger.mode === 'open' ? trigger.documentId : null,
  )
  // Opening an existing doc already knows its status synchronously — no
  // artificial dwell delay needed, only fresh uploads get the clamp below.
  const [dwell, setDwell] = useState<{ docId: string | null; done: boolean }>(() =>
    trigger.mode === 'open' ? { docId: trigger.documentId, done: true } : { docId: null, done: false },
  )
  const [reviewResult, setReviewResult] = useState<ReviewScanResult | null>(null)
  const [entrySettled, setEntrySettled] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const capture = useCaptureSource(fileInputRef, (doc) => setActiveDocId(doc.id))
  const currentDoc = activeDocId ? docs.find((d) => d.id === activeDocId) : undefined

  // A fresh doc starts its minimum-dwell clock the moment it's known, so a
  // sub-second extraction doesn't flash the "processing" copy for <500ms.
  // `dwell.docId !== activeDocId` (below) is the "reset" — the effect only
  // ever calls setState from the timeout callback, never synchronously in
  // its own body.
  useEffect(() => {
    if (!activeDocId) return
    const t = setTimeout(() => setDwell({ docId: activeDocId, done: true }), 1200)
    return () => clearTimeout(t)
  }, [activeDocId])
  const minDwellDone = dwell.docId === activeDocId && dwell.done

  // Ref-counted: reopening mid-collapse means two flows are mounted at once,
  // and the outgoing one's unmount must not unlock the page under the new one.
  useBodyScrollLock()

  const pendingCount = currentDoc ? currentDoc.candidates.filter((c) => !c.taskId).length : 0

  // An upload that never landed has no document to key off, so it reads its
  // phase from the capture hook instead: bytes still held + a message to show
  // means the user can resend rather than re-capture.
  const phase: Phase = reviewResult
    ? 'success'
    : capture.busy
      ? 'uploading'
      : !currentDoc
        ? capture.canRetry
          ? 'uploadFailed'
          : 'choose'
        : currentDoc.status === 'failed'
          ? 'error'
          : currentDoc.status === 'ready_for_review' && minDwellDone
            ? pendingCount > 0
              ? 'review'
              : 'filed'
            : 'processing'

  const isFullscreen = !SHEET_PHASES.includes(phase)

  const sheetShape = {
    top: vp.h - SHEET_HEIGHT - SHEET_MARGIN_BOTTOM,
    left: (vp.w - Math.min(vp.w * 0.92, 440)) / 2,
    width: Math.min(vp.w * 0.92, 440),
    height: SHEET_HEIGHT,
    radius: SHEET_RADIUS,
    background: surface,
  }
  const fullscreenShape = { top: 0, left: 0, width: vp.w, height: vp.h, radius: 0, background: canvas }
  const originShape = {
    top: trigger.rect.top,
    left: trigger.rect.left,
    width: trigger.rect.width,
    height: trigger.rect.height,
    radius: 18,
    background: trigger.originColor ?? surface,
  }

  const targetShape = isFullscreen ? fullscreenShape : sheetShape

  // Abandon this document and go back to capture. Distinct from the two RETRY
  // paths — resending held bytes ('uploadFailed') and re-running extraction on
  // stored bytes ('error') — which both keep the user's capture. This is the
  // fallback for when the document itself is the problem: a blurry photo no
  // number of re-reads will fix.
  const startOver = () => {
    setActiveDocId(null)
    setReviewResult(null)
    capture.dismissRetry()
  }

  return (
    <>
      {/* Dismissal retargets `animate` rather than unmounting this: an exiting
          presence child is a FROZEN snapshot of the props it had while
          present, so a backdrop dropped here on the way out would keep its
          live `onClose` for the length of the fade — and an interrupted
          dismissal leaves that stale backdrop sitting over the flow that
          replaced it, where one tap closes the new one. Kept mounted, it stays
          a real render: the fade still starts on the frame the collapse does,
          and `pointer-events` actually goes dead with it. */}
      <AnimatePresence>
        {!isFullscreen ? (
          <motion.div
            key="capture-backdrop"
            // ~70ms frost against the shell's ~280ms spring: the measured iOS
            // launch has the blur ~92% in by 68ms, so the scrim is frosted
            // before the shell has travelled. See lib/motion-backdrop.ts.
            variants={BACKDROP_BLUR_FADE}
            initial="initial"
            animate={isPresent ? 'animate' : 'exit'}
            exit="exit"
            onClick={onClose}
            aria-hidden
            style={BACKDROP_BLUR_STYLE}
            className={cn(
              'fixed inset-0 z-40 bg-ink/30 backdrop-blur-md',
              !isPresent && 'pointer-events-none',
            )}
          />
        ) : null}
      </AnimatePresence>

      {/* Close is an AnimatePresence EXIT, not a hand-driven "closing" phase:
          the shell collapses back toward the trigger rect WHILE fading to
          zero, exactly like VoiceIsland's exit. The fade is what makes the
          dismissal read as the island receding rather than a blank plane
          sweeping across the screen — a fullscreen surface shrinking at full
          opacity looks like the UI broke. `backgroundColor` is deliberately
          absent from `exit` so the surface holds its own color on the way out
          instead of flushing to the purple origin color mid-collapse. */}
      <motion.div
        role="dialog"
        aria-label={t('header.scan')}
        initial={{
          top: originShape.top,
          left: originShape.left,
          width: originShape.width,
          height: originShape.height,
          borderRadius: originShape.radius,
          backgroundColor: originShape.background,
        }}
        animate={{
          top: targetShape.top,
          left: targetShape.left,
          width: targetShape.width,
          height: targetShape.height,
          borderRadius: targetShape.radius,
          backgroundColor: targetShape.background,
          opacity: 1,
        }}
        exit={{
          top: originShape.top,
          left: originShape.left,
          width: originShape.width,
          height: originShape.height,
          borderRadius: originShape.radius,
          opacity: 0,
        }}
        transition={reduced ? { duration: 0 } : MORPH_SPRING}
        onAnimationComplete={() => setEntrySettled(true)}
        // Nothing on its way out should be interactive — it still covers the
        // screen for the length of the collapse, and once a reopen can happen
        // mid-exit it is covering the flow that replaced it.
        className={cn('fixed z-50 overflow-hidden shadow-elevated', !isPresent && 'pointer-events-none')}
      >
        {/* The two terminal phases carry their own explicit exit button, so
            the corner X would be a second, competing way out. */}
        {phase !== 'success' && phase !== 'error' ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon('close')}
            // Fullscreen, this sits in the notch/Dynamic Island band unless it
            // is pushed past the top inset — the sheet phase never reaches
            // that high, so it keeps its plain 12px.
            style={{ top: isFullscreen ? CONTENT_INSET.top : 12 }}
            className="absolute end-3 z-10 rounded-full p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X size={18} />
          </button>
        ) : null}

        {/* Fullscreen means edge-to-edge under the status bar and the home
            indicator (viewport-fit=cover), so the CONTENT box — not the
            surface — is what has to clear them. */}
        <div
          className="flex h-full w-full flex-col"
          style={
            isFullscreen
              ? {
                  paddingTop: CONTENT_INSET.top,
                  paddingLeft: 24,
                  paddingRight: 24,
                  paddingBottom: CONTENT_INSET.bottom,
                }
              : { padding: 20 }
          }
        >
          {/* Content swap keeps the app-wide timing separation: the outgoing
              phase fades out in 60ms, which is exactly MORPH_SPRING's delay,
              so the shell only starts morphing once it's empty. On dismissal
              this exit is inherited from the shell's own presence exit, so
              the content clears first and the shell fades out behind it —
              no phase content left rendering inside a shrinking box. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={phase}
              variants={MORPH_CONTENT_VARIANTS}
              initial={reduced ? false : 'initial'}
              animate="animate"
              exit="exit"
              className="flex h-full flex-1 flex-col"
            >
              {phase === 'choose' ? (
                <ChoosePhase capture={capture} fileInputRef={fileInputRef} disabled={!entrySettled} />
              ) : phase === 'uploading' ? (
                <BusyPhase
                  icon={<SketchUploadGlyph size={40} className="text-accent" />}
                  label={t('capture.uploading')}
                />
              ) : phase === 'uploadFailed' ? (
                <UploadFailedPhase
                  message={capture.error ?? t('capture.uploadFailed.fallback')}
                  onRetry={() => void capture.retryUpload()}
                  onStartOver={capture.dismissRetry}
                />
              ) : phase === 'processing' ? (
                <ProcessingPhase />
              ) : phase === 'review' && currentDoc ? (
                <ScanReviewCard doc={currentDoc} onReviewed={setReviewResult} />
              ) : phase === 'filed' && currentDoc ? (
                <TaskOverview doc={currentDoc} />
              ) : phase === 'success' && reviewResult ? (
                <SuccessPhase result={reviewResult} onDone={onClose} />
              ) : phase === 'error' && currentDoc ? (
                <ErrorPhase doc={currentDoc} onScanAgain={startOver} onClose={onClose} />
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  )
}

function ChoosePhase({
  capture,
  fileInputRef,
  disabled,
}: {
  capture: UseCaptureSourceResult
  fileInputRef: React.RefObject<HTMLInputElement | null>
  disabled: boolean
}) {
  const t = useTranslations('scan')

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="pe-8">
        <span className="text-label uppercase text-accent">{t('header.scan')}</span>
        <h2 className="font-display text-heading-md text-ink">{t('capture.chooseTitle')}</h2>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3">
        <ChooseButton
          icon={<SketchCameraGlyph size={30} />}
          label={t('capture.takePhoto')}
          disabled={disabled || capture.busy}
          onClick={() => void capture.captureCamera()}
        />
        <ChooseButton
          icon={<SketchUploadGlyph size={30} />}
          label={t('capture.chooseFile')}
          disabled={disabled || capture.busy}
          onClick={capture.captureFile}
        />
      </div>

      {capture.error ? <p className="text-caption text-danger">{capture.error}</p> : null}
      <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => void capture.onFileChosen(e)} />
    </div>
  )
}

function ChooseButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3.5 rounded-2xl bg-surface p-4 text-start shadow-card transition-colors hover:bg-surface-sunken disabled:opacity-50"
    >
      <span className="text-accent">{icon}</span>
      <span className="text-heading-sm text-ink">{label}</span>
    </button>
  )
}

function BusyPhase({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <span className="animate-pulse">{icon}</span>
      <p className="text-body-sm text-ink-muted">{label}</p>
    </div>
  )
}

// Built per render rather than hoisted to a module const — a const outside the
// component cannot call a hook, and three reassuring lines that stay English
// while the rest of the screen turns over is the most conspicuous place to miss.
function ProcessingPhase() {
  const t = useTranslations('scan')
  const lines = [
    t('capture.processing.reading'),
    t('capture.processing.finding'),
    t('capture.processing.almost'),
  ]
  const [i, setI] = useState(0)
  useEffect(() => {
    if (i >= lines.length - 1) return
    const id = setTimeout(() => setI((n) => n + 1), 1800)
    return () => clearTimeout(id)
    // `lines.length` is a constant 3; depending on the array itself would
    // restart the timer on every render.
  }, [i, lines.length])
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <ScanningDocumentGlyph size={80} className="text-accent" />
      <p className="text-body text-ink-muted">{lines[i]}</p>
    </div>
  )
}

function SuccessPhase({ result, onDone }: { result: ReviewScanResult; onDone: () => void }) {
  const t = useTranslations('scan')
  const tCommon = useTranslations('common')
  const reduced = useReducedMotion()
  const count = result.tasks.length
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
      <motion.div
        initial={reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0 } : MORPH_SPRING}
      >
        <SketchCheckGlyph size={88} className="text-accent" />
      </motion.div>
      <div>
        <h2 className="font-display text-display-md text-ink">
          {t('capture.success.title', { count })}
        </h2>
        <p className="mt-1 text-body text-ink-muted">
          {count === 0
            ? t('capture.success.bodyEmpty')
            : t('capture.success.body', { appName: env.appName })}
        </p>
      </div>
      <Button variant="solid" className="w-full max-w-xs" onClick={onDone}>
        {tCommon('done')}
      </Button>
    </div>
  )
}

// Upload never landed. The bytes are still in memory, so the primary action
// resends them — the user does not go back through capture, which for a camera
// shot would mean finding and re-photographing the physical document.
function UploadFailedPhase({
  message,
  onRetry,
  onStartOver,
}: {
  message: string
  onRetry: () => void
  onStartOver: () => void
}) {
  const t = useTranslations('scan')
  const tCommon = useTranslations('common')

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="pe-8">
        <span className="text-label uppercase text-danger">{t('capture.uploadFailed.eyebrow')}</span>
        <h2 className="font-display text-heading-md text-ink">{t('capture.uploadFailed.title')}</h2>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3">
        <p className="text-body-sm text-ink-muted">{message}</p>
        <Button variant="solid" onClick={onRetry}>
          {tCommon('tryAgain')}
        </Button>
        <Button variant="ghost" onClick={onStartOver}>
          {t('capture.uploadFailed.startOver')}
        </Button>
      </div>
    </div>
  )
}

// Upload landed, extraction failed. The original bytes are durable on the
// server, so "Try again" re-runs the read rather than sending the user back to
// capture — see POST /me/document-scans/:id/reprocess.
function ErrorPhase({
  doc,
  onScanAgain,
  onClose,
}: {
  doc: ScannedDocument
  onScanAgain: () => void
  onClose: () => void
}) {
  const t = useTranslations('scan')
  const tCommon = useTranslations('common')
  const reprocess = useReprocessScannedDocument()
  const retryFailed = reprocess.error instanceof Error ? reprocess.error.message : null

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-body text-ink">{doc.failureReason ?? t('capture.error.fallback')}</p>

      {doc.canRetry ? (
        <p className="text-caption text-ink-muted">{t('capture.error.savedNote')}</p>
      ) : null}

      {retryFailed ? <p className="text-caption text-danger">{retryFailed}</p> : null}

      <div className="flex flex-col items-center gap-2">
        {doc.canRetry ? (
          <Button
            variant="solid"
            className="w-full max-w-xs"
            disabled={reprocess.isPending}
            onClick={() => reprocess.mutate(doc.id)}
          >
            {reprocess.isPending ? t('capture.error.retrying') : tCommon('tryAgain')}
          </Button>
        ) : null}
        <div className="flex gap-2">
          <Button variant="outline" onClick={onScanAgain}>
            {t('capture.error.scanAgain')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
