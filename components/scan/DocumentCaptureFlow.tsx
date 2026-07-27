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

import { SketchCameraGlyph, SketchCheckGlyph, SketchUploadGlyph } from '@/components/icons/sketch/flowGlyphs'
import { ScanningDocumentGlyph } from '@/components/icons/sketch/ScanningDocumentGlyph'
import { ScanReviewCard } from '@/components/scan/ScanReviewCard'
import { TaskOverview } from '@/components/scan/TaskOverview'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useCaptureSource, type UseCaptureSourceResult } from '@/lib/documentScan/useCaptureSource'
import { useMorphColors } from '@/lib/motion-colors'
import { MORPH_BACKDROP_FADE, MORPH_CONTENT_VARIANTS, MORPH_SPRING } from '@/lib/motion'
import { useBodyScrollLock } from '@/lib/scrollLock'
import type { ReviewScanResult, ScannedDocument } from '@/queries/documentScans'

// `id` is the open's identity, not data — the host keys the flow by it so each
// open mounts a fresh instance instead of inheriting the last one's state.
export type DocumentCaptureTrigger =
  | { id: number; rect: DOMRect; mode: 'capture'; originColor?: string }
  | { id: number; rect: DOMRect; mode: 'open'; documentId: string; originColor?: string }

type Phase = 'choose' | 'uploading' | 'processing' | 'review' | 'filed' | 'success' | 'error'

const SHEET_HEIGHT = 300
const SHEET_MARGIN_BOTTOM = 20
const SHEET_RADIUS = 26

interface DocumentCaptureFlowProps {
  docs: ScannedDocument[]
  trigger: DocumentCaptureTrigger
  onClose: () => void
}

export function DocumentCaptureFlow({ docs, trigger, onClose }: DocumentCaptureFlowProps) {
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

  const phase: Phase = reviewResult
    ? 'success'
    : capture.busy
      ? 'uploading'
      : !currentDoc
        ? 'choose'
        : currentDoc.status === 'failed'
          ? 'error'
          : currentDoc.status === 'ready_for_review' && minDwellDone
            ? pendingCount > 0
              ? 'review'
              : 'filed'
            : 'processing'

  const isFullscreen = phase !== 'choose' && phase !== 'uploading'

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

  const retryAfterFailure = () => {
    setActiveDocId(null)
    setReviewResult(null)
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
            variants={MORPH_BACKDROP_FADE}
            initial="initial"
            animate={isPresent ? 'animate' : 'exit'}
            exit="exit"
            onClick={onClose}
            aria-hidden
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
        aria-label="Scan a document"
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
        {phase === 'choose' ||
        phase === 'uploading' ||
        phase === 'processing' ||
        phase === 'review' ||
        phase === 'filed' ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X size={18} />
          </button>
        ) : null}

        <div className="flex h-full w-full flex-col" style={{ padding: isFullscreen ? '30px 24px 24px' : '20px' }}>
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
                <BusyPhase icon={<SketchUploadGlyph size={40} className="text-accent" />} label="Getting your document ready…" />
              ) : phase === 'processing' ? (
                <ProcessingPhase />
              ) : phase === 'review' && currentDoc ? (
                <ScanReviewCard doc={currentDoc} onReviewed={setReviewResult} />
              ) : phase === 'filed' && currentDoc ? (
                <TaskOverview doc={currentDoc} />
              ) : phase === 'success' && reviewResult ? (
                <SuccessPhase result={reviewResult} onDone={onClose} />
              ) : phase === 'error' ? (
                <ErrorPhase
                  message={currentDoc?.failureReason ?? "Couldn't process that scan. Try again."}
                  onRetry={retryAfterFailure}
                  onClose={onClose}
                />
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
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="pr-8">
        <span className="text-label uppercase text-accent">Scan a document</span>
        <h2 className="font-display text-heading-md text-ink">Add a bill, letter, or form</h2>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-3">
        <ChooseButton
          icon={<SketchCameraGlyph size={30} />}
          label="Take a photo"
          disabled={disabled || capture.busy}
          onClick={() => void capture.captureCamera()}
        />
        <ChooseButton
          icon={<SketchUploadGlyph size={30} />}
          label="Choose a file"
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
      className="flex items-center gap-3.5 rounded-2xl bg-surface p-4 text-left shadow-card transition-colors hover:bg-surface-sunken disabled:opacity-50"
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

const PROCESSING_LINES = ['Reading your document…', 'Finding what matters…', 'Almost done…']

function ProcessingPhase() {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (i >= PROCESSING_LINES.length - 1) return
    const id = setTimeout(() => setI((n) => n + 1), 1800)
    return () => clearTimeout(id)
  }, [i])
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <ScanningDocumentGlyph size={80} className="text-accent" />
      <p className="text-body text-ink-muted">{PROCESSING_LINES[i]}</p>
    </div>
  )
}

function SuccessPhase({ result, onDone }: { result: ReviewScanResult; onDone: () => void }) {
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
          {count === 0 ? 'All set.' : count === 1 ? '1 matter filed.' : `${count} matters filed.`}
        </h2>
        <p className="mt-1 text-body text-ink-muted">
          {count === 0 ? 'Nothing was kept from this scan.' : 'Mo will remind you when it counts.'}
        </p>
      </div>
      <Button variant="solid" className="w-full max-w-xs" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}

function ErrorPhase({ message, onRetry, onClose }: { message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <p className="text-body text-ink">{message}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}
