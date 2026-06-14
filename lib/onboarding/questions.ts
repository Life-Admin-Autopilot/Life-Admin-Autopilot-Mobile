// Onboarding flow config. A fast Q&A: a name, a few quick-pick questions, then
// the domain selection. The quick-pick answers are persisted as AI memory
// (onboardingAnswers) for later personalization. Edit/extend this array freely —
// the OnboardingIsland renders whatever steps are here.

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
  /** Morph-card height for this step (px). Width is shared. */
  height: number
}

export const ISLAND_WIDTH = 348

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'name',
    kind: 'name',
    question: 'What should I call you?',
    hint: 'A first name is enough.',
    height: 236,
  },
  {
    id: 'focus',
    kind: 'choice',
    question: 'What weighs on you most?',
    options: [
      { value: 'renewals', label: 'Renewals & bills' },
      { value: 'appointments', label: 'Appointments' },
      { value: 'documents', label: 'Documents & admin' },
      { value: 'family', label: 'Family & school' },
    ],
    height: 318,
  },
  {
    id: 'pace',
    kind: 'choice',
    question: 'How full is your week?',
    options: [
      { value: 'packed', label: 'Packed' },
      { value: 'steady', label: 'Steady' },
      { value: 'light', label: 'Light' },
    ],
    height: 280,
  },
  {
    id: 'tone',
    kind: 'choice',
    question: 'How should I speak to you?',
    options: [
      { value: 'brief', label: 'Briefly' },
      { value: 'detailed', label: 'With detail' },
    ],
    height: 256,
  },
  {
    id: 'domains',
    kind: 'domains',
    question: 'Which areas need watching?',
    hint: 'Pick any. Change them later.',
    height: 392,
  },
  {
    id: 'done',
    kind: 'done',
    question: 'All good to go.',
    height: 208,
  },
]
