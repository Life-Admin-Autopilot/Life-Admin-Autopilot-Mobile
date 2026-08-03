// Onboarding flow config. A fast Q&A: a name, a few quick-pick questions, then
// the domain selection. The quick-pick answers are persisted as AI memory
// (onboardingAnswers) for later personalization. Edit/extend this array freely —
// the OnboardingIsland renders whatever steps are here.
//
// NO PROSE LIVES HERE. This module is plain data with no React on the stack, so
// it cannot call `useTranslations`; every user-facing string is a key into the
// `onboarding` namespace, resolved by the component that renders it. The keys
// are DERIVED from the step id and the option value rather than stored
// alongside them — `questionKey`/`optionKey` below return template-literal
// types, so adding a step id without adding `steps.<id>` to both catalogues is
// a compile error, not a raw key path rendered at a stranger's first contact
// with the app.

import type { CatColor } from '@/components/ui/EmojiChip'

export type StepKind = 'name' | 'choice' | 'domains' | 'done'

/** Every step in the flow. Also the message key under `onboarding.steps`. */
export type StepId = 'name' | 'focus' | 'pace' | 'tone' | 'domains' | 'done'

/** Steps that carry a line of guidance under the question. */
export type HintId = Extract<StepId, 'name' | 'domains'>

/**
 * Quick-pick answer identities. Unique across every step on purpose: they are
 * the stable ids persisted with the answer, and they key `onboarding.options`
 * as one flat map rather than nesting per step.
 */
export type ChoiceValue =
  | 'renewals'
  | 'appointments'
  | 'documents'
  | 'family'
  | 'packed'
  | 'steady'
  | 'light'
  | 'brief'
  | 'detailed'

export type QuestionKey = `steps.${StepId}`
export type HintKey = `hints.${HintId}`
export type OptionKey = `options.${ChoiceValue}`

export const questionKey = (id: StepId): QuestionKey => `steps.${id}`
export const optionKey = (value: ChoiceValue): OptionKey => `options.${value}`

export interface OnboardingStep {
  id: StepId
  kind: StepKind
  /** Named rather than derived: most steps have no hint, and an absent key throws. */
  hintKey?: HintKey
  options?: ChoiceValue[]
  /** Identity glyph for the step — the signature emoji-in-a-pastel-circle. */
  emoji: string
  category: CatColor
  /**
   * First-paint estimate of the card height (px), NOT the truth. The card
   * measures itself and morphs the shell to fit, so copy edits can't weld the
   * CTA to the field the way a hardcoded height once did. Keep this in the
   * right ballpark anyway: it's the target the shell springs toward for the one
   * frame before the incoming pane reports its real height.
   *
   * It is also why translation cannot break the layout: Arabic runs longer than
   * English on several of these questions, and the measured height absorbs it.
   */
  height: number
}

export const ISLAND_WIDTH = 348

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'name',
    kind: 'name',
    hintKey: 'hints.name',
    emoji: '👋',
    category: 'peach',
    height: 274,
  },
  {
    id: 'focus',
    kind: 'choice',
    emoji: '🧺',
    category: 'lilac',
    options: ['renewals', 'appointments', 'documents', 'family'],
    height: 306,
  },
  {
    id: 'pace',
    kind: 'choice',
    emoji: '🗓️',
    category: 'sky',
    options: ['packed', 'steady', 'light'],
    height: 210,
  },
  {
    id: 'tone',
    kind: 'choice',
    emoji: '💬',
    category: 'sage',
    options: ['brief', 'detailed'],
    height: 210,
  },
  {
    id: 'domains',
    kind: 'domains',
    hintKey: 'hints.domains',
    emoji: '🗂️',
    category: 'periwinkle',
    height: 416,
  },
  {
    id: 'done',
    kind: 'done',
    emoji: '✨',
    category: 'yellow',
    height: 212,
  },
]
