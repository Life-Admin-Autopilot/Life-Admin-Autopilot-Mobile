'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { type Domain } from '@/components/icons/DomainIcon'
import { ChoiceChip, DomainChip } from '@/components/onboarding/QuestionChips'
import { IslandHandoff } from '@/components/onboarding/IslandHandoff'
import {
  OnboardingCard,
  OnboardingCta,
  StepHeader,
  headingId,
  type MeasureFn,
} from '@/components/onboarding/OnboardingCard'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { EmojiChip } from '@/components/ui/EmojiChip'
import { Input } from '@/components/ui/input'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'
import { api } from '@/lib/api/client'
import { useSessionStore, type AuthUser, type OnboardingAnswer } from '@/lib/auth/sessionStore'
import { translateBackendError } from '@/lib/translateBackendError'
import { ONBOARDING_STEPS, ISLAND_WIDTH, type OnboardingStep } from '@/lib/onboarding/questions'

const DOMAINS: { key: Domain; label: string }[] = [
  { key: 'health', label: 'Health' },
  { key: 'home', label: 'Home' },
  { key: 'car', label: 'Car' },
  { key: 'finance', label: 'Finance' },
  { key: 'family', label: 'Family' },
  { key: 'pets', label: 'Pets' },
]

// One morphing island across the whole onboarding — each step morphs (size +
// content fade) via the Wiscord engine; the final "all good to go" expands into
// the home via IslandHandoff. Quick-pick answers persist as AI memory.
//
// Card heights are MEASURED, not declared: each pane reports its own height and
// the shell springs to it. The numbers in ONBOARDING_STEPS are only the
// first-frame target, so growing the copy can never crush the layout.
export function OnboardingIsland() {
  const router = useRouter()
  const setUser = useSessionStore((s) => s.setUser)
  const [stepIndex, setStepIndex] = useState(0)
  const [name, setName] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [domains, setDomains] = useState<Domain[]>(DOMAINS.map((d) => d.key))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [handoff, setHandoff] = useState(false)
  const [handoffRect, setHandoffRect] = useState<DOMRect | null>(null)
  const [measured, setMeasured] = useState<Record<string, number>>({})
  const islandRef = useRef<HTMLDivElement>(null)
  const savedUser = useRef<AuthUser | null>(null)

  const step = ONBOARDING_STEPS[stepIndex]
  const firstName = name.trim().split(/\s+/)[0] || 'there'

  const onMeasure = useCallback<MeasureFn>((stepId, height) => {
    setMeasured((m) => (m[stepId] === height ? m : { ...m, [stepId]: height }))
  }, [])

  const shapes = useMemo<Record<string, MorphShape>>(
    () =>
      Object.fromEntries(
        ONBOARDING_STEPS.map((s) => [
          s.id,
          { width: ISLAND_WIDTH, height: measured[s.id] ?? s.height, radius: 30 },
        ]),
      ),
    [measured],
  )

  const goNext = () => setStepIndex((i) => Math.min(i + 1, ONBOARDING_STEPS.length - 1))
  const goBack = () => setStepIndex((i) => Math.max(i - 1, 0))

  const pickChoice = (s: OnboardingStep, value: string) => {
    setAnswers((a) => ({ ...a, [s.id]: value }))
    goNext()
  }

  const toggleDomain = (key: Domain) =>
    setDomains((d) => (d.includes(key) ? d.filter((x) => x !== key) : [...d, key]))

  const buildAnswers = (): OnboardingAnswer[] =>
    ONBOARDING_STEPS.filter((s) => s.kind === 'choice' && answers[s.id]).map((s) => ({
      id: s.id,
      question: s.question,
      answer: s.options?.find((o) => o.value === answers[s.id])?.label ?? answers[s.id],
    }))

  const handleEnter = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const { user } = await api<{ user: AuthUser }>('/me', {
        method: 'PATCH',
        body: {
          displayName: name.trim() || undefined,
          preferredDomains: domains,
          onboardingAnswers: buildAnswers(),
          hasOnboarded: true,
        },
      })
      savedUser.current = user
      // Snapshot the island's live geometry so the handoff extends FROM it
      // (the Dynamic Island grows to fill the screen) instead of popping a
      // new pill at screen-center.
      setHandoffRect(islandRef.current?.getBoundingClientRect() ?? null)
      setHandoff(true)
    } catch (e) {
      setError(translateBackendError(e))
      setSubmitting(false)
    }
  }

  // Commit the session once the handoff morph settles — the onboarding route
  // gate then carries us to /dashboard.
  const finalize = () => {
    if (savedUser.current) setUser(savedUser.current)
    router.replace('/dashboard')
  }

  const canBack = stepIndex > 0 && step.kind !== 'done'

  return (
    <main className="bg-hero-gradient grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-5">
        <MorphSurface ref={islandRef} state={step.id} shapes={shapes} className="bg-surface">
          {step.kind === 'name' ? (
            <OnboardingCard stepId={step.id} onMeasure={onMeasure}>
              <StepHeader step={step} canBack={canBack} onBack={goBack} />
              <label htmlFor="onboarding-name" className="sr-only">
                Your name
              </label>
              <Input
                id="onboarding-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) goNext()
                }}
                autoFocus
                autoComplete="given-name"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="next"
                placeholder="Your name"
                className="mt-5"
              />
              <OnboardingCta className="mt-4" disabled={!name.trim()} onClick={goNext}>
                Continue
              </OnboardingCta>
            </OnboardingCard>
          ) : step.kind === 'choice' ? (
            <OnboardingCard stepId={step.id} onMeasure={onMeasure}>
              <StepHeader step={step} canBack={canBack} onBack={goBack} />
              <div role="group" aria-labelledby={headingId(step.id)} className="mt-5 flex flex-wrap gap-2">
                {step.options?.map((o) => (
                  <ChoiceChip
                    key={o.value}
                    label={o.label}
                    selected={answers[step.id] === o.value}
                    onClick={() => pickChoice(step, o.value)}
                  />
                ))}
              </div>
            </OnboardingCard>
          ) : step.kind === 'domains' ? (
            <OnboardingCard stepId={step.id} onMeasure={onMeasure}>
              <StepHeader step={step} canBack={canBack} onBack={goBack} />
              <div
                role="group"
                aria-labelledby={headingId(step.id)}
                className="mt-5 grid grid-cols-2 gap-2.5"
              >
                {DOMAINS.map((d) => (
                  <DomainChip
                    key={d.key}
                    domain={d.key}
                    label={d.label}
                    selected={domains.includes(d.key)}
                    onClick={() => toggleDomain(d.key)}
                  />
                ))}
              </div>
              <OnboardingCta className="mt-4" disabled={domains.length === 0} onClick={goNext}>
                Continue
              </OnboardingCta>
            </OnboardingCard>
          ) : (
            <OnboardingCard
              stepId={step.id}
              onMeasure={onMeasure}
              className="items-center py-9 text-center"
            >
              <EmojiChip emoji={step.emoji} category={step.category} size={44} tilt />
              <h2 className="mt-4 font-display-wonk font-display text-display-md text-ink">
                {step.question}
              </h2>
              <p className="mt-1 text-body text-ink-muted">
                I&apos;ll keep your file in order, {firstName}.
              </p>
              {error ? (
                <p role="alert" className="mt-2 text-body-sm text-danger">
                  {error}
                </p>
              ) : null}
              <OnboardingCta className="mt-5" disabled={submitting} onClick={handleEnter}>
                {submitting ? 'One moment…' : 'Enter'}
              </OnboardingCta>
            </OnboardingCard>
          )}
        </MorphSurface>

        <OnboardingProgress total={ONBOARDING_STEPS.length} index={stepIndex} />
      </div>

      {handoff ? (
        <IslandHandoff name={firstName} fromRect={handoffRect} onComplete={finalize} />
      ) : null}
    </main>
  )
}
