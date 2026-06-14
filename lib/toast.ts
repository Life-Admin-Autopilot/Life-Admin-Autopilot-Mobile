// Toast — single notification surface (AGENTS.md → Primitives). The visible
// queue is <Toaster /> (components/ui/sonner.tsx) mounted at the app root. All
// feature code uses the imperative `toast.*` API below; never call sonner
// directly. Same surface v1 exposed, re-backed by sonner for web.

import { createElement } from 'react'
import { toast as sonnerToast } from 'sonner'

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
  dismiss: (id: string) => sonnerToast.dismiss(id),
}
