// Toast — single notification surface (AGENTS.md → Primitives). The visible
// queue is <Toaster /> (components/ui/sonner.tsx) mounted at the app root. All
// feature code uses the imperative `toast.*` API below; never call sonner
// directly. Same surface v1 exposed, re-backed by sonner for web.

import { createElement } from 'react'
import { toast as sonnerToast } from 'sonner'

import { DecisionToast } from '@/components/ui/DecisionToast'
import { MorphToast } from '@/components/ui/MorphToast'

export type ToastVariant = 'success' | 'error' | 'info' | 'loading'

export interface ToastAction {
  label: string
  onPress: () => void
}

interface ToastOptions {
  description?: string
  action?: ToastAction
}

function toAction(action?: ToastAction) {
  if (!action) return undefined
  return { label: action.label, onClick: action.onPress }
}

export const toast = {
  success: (title: string, opts?: ToastOptions): string =>
    String(
      sonnerToast.success(title, {
        description: opts?.description,
        action: toAction(opts?.action),
      }),
    ),
  error: (title: string, opts?: ToastOptions): string =>
    String(
      sonnerToast.error(title, {
        description: opts?.description,
        action: toAction(opts?.action),
      }),
    ),
  info: (title: string, opts?: ToastOptions): string =>
    String(
      sonnerToast.info(title, {
        description: opts?.description,
        action: toAction(opts?.action),
      }),
    ),
  loading: (title: string, opts?: Pick<ToastOptions, 'description'>): string =>
    String(sonnerToast.loading(title, { description: opts?.description })),
  // Morph-in notification (the Dynamic Island feel) — a pill grows into the
  // toast. Rendered via sonner's custom slot; sonner owns stacking/dismiss.
  morph: (title: string, opts?: Pick<ToastOptions, 'description'>): string =>
    String(
      sonnerToast.custom(
        () =>
          // sonner's custom-toast row is its default width; wrap in a full-width
          // centering flex so the narrower morph card sits centered (top-center).
          createElement(
            'div',
            { className: 'flex w-full justify-center' },
            createElement(MorphToast, { title, description: opts?.description }),
          ),
        { duration: 3200 },
      ),
    ),
  // A decision, not a notice — the square panel with two weighted answers
  // (components/ui/DecisionToast). Both buttons dismiss the panel themselves
  // after running their action.
  //
  // Sticks by default, and the default is deliberately the cautious one: a panel
  // that fades while it is the ONLY copy of a question has thrown that question
  // away.
  //
  // `duration` is for decisions that survive their own dismissal, and both voice
  // panels now qualify. A CLASH is a fact about two saved matters — also on the
  // dashboard, in the conflicts sheet and on the matter's own detail sheet. A
  // voice QUESTION is a persisted Clarification — also in the bell and in the
  // uncertainty stack. In both cases the panel announces something durable
  // rather than holding the only record of it.
  //
  // The rule this leaves behind: pass a duration only once you can name where the
  // decision still lives afterwards. A caller that cannot answer that should let
  // it stick.
  decide: (opts: {
    tone: 'clash' | 'question'
    title: string
    description?: string
    primary: { label: string; onPress: () => void }
    secondary: { label: string; onPress: () => void }
    /** Auto-dismiss after N ms. Omit to stick until answered. */
    duration?: number
  }): string => {
    const id = sonnerToast.custom(
      (toastId) =>
        createElement(
          'div',
          { className: 'flex w-full justify-center' },
          createElement(DecisionToast, {
            tone: opts.tone,
            title: opts.title,
            description: opts.description,
            // The panel owns the clock — see DecisionToast. Sonner's own timer
            // pauses on hover and its countdown bar does not, so handing the
            // duration to both left a drained bar over a panel that stayed.
            duration: opts.duration,
            onExpire: () => sonnerToast.dismiss(toastId),
            primary: {
              label: opts.primary.label,
              onPress: () => {
                sonnerToast.dismiss(toastId)
                opts.primary.onPress()
              },
            },
            secondary: {
              label: opts.secondary.label,
              onPress: () => {
                sonnerToast.dismiss(toastId)
                opts.secondary.onPress()
              },
            },
          }),
        ),
      // Always Infinity: dismissal is the panel's job now, and two timers on
      // one toast is how they disagree.
      { duration: Infinity },
    )
    return String(id)
  },
  dismiss: (id: string) => sonnerToast.dismiss(id),
}
