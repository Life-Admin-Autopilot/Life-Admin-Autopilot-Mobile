// Onboarding flow config. A fast Q&A: a name, a few quick-pick questions, then
// the domain selection. The quick-pick answers are persisted as AI memory
// (onboardingAnswers) for later personalization. Edit/extend this array freely —
// the OnboardingIsland renders whatever steps are here.

import type { CatColor } from '@/components/ui/EmojiChip'

export type StepKind = 'name' | 'choice' | 'domains' | 'done'

export interface ChoiceOption {
  value: string
  label: string
}

export interface OnboardingStep {
  id: string
  kind: StepKind
  question: string
  hint?: string
  options?: ChoiceOption[]
  /** Identity glyph for the step — the signature emoji-in-a-pastel-circle. */
  emoji: string
  category: CatColor
  /**
   * First-paint estimate of the card height (px), NOT the truth. The card
   * measures itself and morphs the shell to fit, so copy edits can't weld the
   * CTA to the field the way a hardcoded height once did. Keep this in the
   * right ballpark anyway: it's the target the shell springs toward for the one
   * frame before the incoming pane reports its real height.
   */
  height: number
}

export const ISLAND_WIDTH = 348

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'name',
    kind: 'name',
    question: 'What should I call you?',
    hint: 'A first name is enough.',
    emoji: '👋',
    category: 'peach',
    height: 274,
  },
  {
    id: 'focus',
    kind: 'choice',
    question: 'What weighs on you most?',
    emoji: '🧺',
    category: 'lilac',
    options: [
      { value: 'renewals', label: 'Renewals & bills' },
      { value: 'appointments', label: 'Appointments' },
      { value: 'documents', label: 'Documents & admin' },
      { value: 'family', label: 'Family & school' },
    ],
    height: 306,
  },
  {
    id: 'pace',
    kind: 'choice',
    question: 'How full is your week?',
    emoji: '🗓️',
    category: 'sky',
    options: [
      { value: 'packed', label: 'Packed' },
      { value: 'steady', label: 'Steady' },
      { value: 'light', label: 'Light' },
    ],
    height: 210,
  },
  {
    id: 'tone',
    kind: 'choice',
    question: 'How should I speak to you?',
    emoji: '💬',
    category: 'sage',
    options: [
      { value: 'brief', label: 'Briefly' },
      { value: 'detailed', label: 'With detail' },
    ],
    height: 210,
  },
  {
    id: 'domains',
    kind: 'domains',
    question: 'Which areas need watching?',
    hint: 'Pick any. Change them later.',
    emoji: '🗂️',
    category: 'periwinkle',
    height: 416,
  },
  {
    id: 'done',
    kind: 'done',
    question: 'All good to go.',
    emoji: '✨',
    category: 'yellow',
    height: 212,
  },
]
