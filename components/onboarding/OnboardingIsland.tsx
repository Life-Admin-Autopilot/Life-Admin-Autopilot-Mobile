'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { type Domain } from '@/components/icons/DomainIcon'
import { ChoiceChip, DomainChip } from '@/components/onboarding/QuestionChips'
import { IslandHandoff } from '@/components/onboarding/IslandHandoff'
import { Button } from '@/components/ui/button'
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

const SHAPES: Record<string, MorphShape> = Object.fromEntries(
  ONBOARDING_STEPS.map((s) => [s.id, { width: ISLAND_WIDTH, height: s.height, radius: 26 }]),
)

// One morphing island across the whole onboarding — each step morphs (size +
// content fade) via the Wiscord engine; the final "all good to go" expands into
// the home via IslandHandoff. Quick-pick answers persist as AI memory.
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
  const islandRef = useRef<HTMLDivElement>(null)
  const savedUser = useRef<AuthUser | null>(null)

  const step = ONBOARDING_STEPS[stepIndex]
  const firstName = name.trim().split(/\s+/)[0] || 'there'

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
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-5">
        <MorphSurface ref={islandRef} state={step.id} shapes={SHAPES}>
          {step.kind === 'name' ? (
            <Pane>
              <StepHeader step={step} canBack={canBack} onBack={goBack} />
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) goNext()
                }}
                autoFocus
                placeholder="Your name"
                className="mt-3 h-11"
              />
              <Button className="mt-auto h-11 w-full" disabled={!name.trim()} onClick={goNext}>
                Continue
              </Button>
            </Pane>
          ) : step.kind === 'choice' ? (
            <Pane>
              <StepHeader step={step} canBack={canBack} onBack={goBack} />
              <div className="mt-4 flex flex-wrap gap-2">
                {step.options?.map((o) => (
                  <ChoiceChip
                    key={o.value}
                    label={o.label}
                    selected={answers[step.id] === o.value}
                    onClick={() => pickChoice(step, o.value)}
                  />
                ))}
              </div>
            </Pane>
          ) : step.kind === 'domains' ? (
            <Pane>
              <StepHeader step={step} canBack={canBack} onBack={goBack} />
              <div className="mt-4 grid grid-cols-2 gap-2.5">
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
              <Button
                className="mt-auto h-11 w-full"
                disabled={domains.length === 0}
                onClick={goNext}
              >
                Continue
              </Button>
            </Pane>
          ) : (
            <Pane center>
              <h2 className="font-display text-display-md text-ink">{step.question}</h2>
              <p className="text-body text-ink-muted">I&apos;ll keep your file in order, {firstName}.</p>
              {error ? <p className="text-caption text-danger">{error}</p> : null}
              <Button
                className="mt-2 h-11 w-full"
                disabled={submitting}
                onClick={handleEnter}
              >
                {submitting ? 'One moment…' : 'Enter'}
              </Button>
            </Pane>
          )}
        </MorphSurface>

        <ProgressDots total={ONBOARDING_STEPS.length} index={stepIndex} />
      </div>

      {handoff ? (
        <IslandHandoff name={firstName} fromRect={handoffRect} onComplete={finalize} />
      ) : null}
    </main>
  )
}

function Pane({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <div
      className={`flex h-full flex-col p-5 ${center ? 'items-center justify-center gap-2 text-center' : ''}`}
    >
      {children}
    </div>
  )
}

function StepHeader({
  step,
  canBack,
  onBack,
}: {
  step: OnboardingStep
  canBack: boolean
  onBack: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-5 items-center gap-2">
        {canBack ? (
          <button onClick={onBack} aria-label="Back" className="text-ink-subtle hover:text-ink">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <span className="text-label uppercase text-accent">Onboarding</span>
      </div>
      <h2 className="font-display text-heading-xl text-ink">{step.question}</h2>
      {step.hint ? <p className="text-caption text-ink-subtle">{step.hint}</p> : null}
    </div>
  )
}

function ProgressDots({ total, index }: { total: number; index: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={`size-1.5 rounded-full ${
            i === index ? 'bg-accent' : i < index ? 'bg-accent/40' : 'bg-border-strong'
          }`}
        />
      ))}
    </div>
  )
}
