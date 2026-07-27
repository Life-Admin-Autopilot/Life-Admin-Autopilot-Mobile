'use client'

import { useState } from 'react'
import { Clock, Home, Sparkles, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CompletionRing, SelectionCheck, Toggle } from '@/components/ui/CompletionRing'
import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'
import { GradientHero } from '@/components/ui/GradientHero'
import { Input } from '@/components/ui/input'
import { Pill, type PillTone } from '@/components/ui/Pill'
import { SectionHeaderChip, type ChipTone } from '@/components/ui/SectionHeaderChip'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { MorphSheet, ChipToggle, SheetSection } from '@/components/ui/Sheet'
import { StatStrip, StatTile } from '@/components/ui/StatTile'
import { TabBar } from '@/components/ui/TabBar'
import { TaskRow } from '@/components/ui/TaskRow'

// Live design-system reference. Everything here imports the REAL primitives —
// a styleguide that keeps local copies of the components stops telling you the
// truth the first time one of them changes.
//
// This is also the light/dark QA harness: flip the theme at the top and every
// surface below should still feel deliberate, not merely legible.

const DOMAINS: Domain[] = ['health', 'home', 'car', 'finance', 'family', 'pets']

const CATS: CatColor[] = [
  'lilac',
  'periwinkle',
  'sky',
  'sage',
  'yellow',
  'peach',
  'blush',
  'pink',
]

const CHIP_TONES: ChipTone[] = [
  'anytime',
  'morning',
  'afternoon',
  'evening',
  'high',
  'medium',
  'low',
]

const PILL_TONES: PillTone[] = [
  'accent',
  'field',
  'surface',
  'high',
  'medium',
  'low',
  'success',
  'danger',
]

export default function StyleguidePage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [done, setDone] = useState(false)
  const [on, setOn] = useState(true)
  const [seg, setSeg] = useState<'list' | 'board'>('list')
  const [chipOpen, setChipOpen] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [trigger, setTrigger] = useState<DOMRect | null>(null)

  return (
    <main className="min-h-dvh pb-36">
      <header className="pt-safe sticky top-0 z-20 flex items-center justify-between bg-canvas/95 px-5 pb-3 backdrop-blur-xl">
        <span className="font-display text-heading-serif text-ink">Styleguide</span>
        <Button
          variant="secondary"
          size="pill"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          <Sun />
          {resolvedTheme === 'dark' ? 'Light' : 'Dark'}
        </Button>
      </header>

      <div className="flex flex-col gap-9 px-5 pt-4">
        <Section title="Type" hint="Fraunces for headline moments, Nunito for everything else">
          <div className="flex flex-col gap-2">
            <p className="font-display text-display-hero text-ink">Good evening.</p>
            <p className="font-display text-display-md text-ink">Display · 32</p>
            <p className="font-display text-heading-serif text-ink">Heading serif · 26</p>
            <p className="font-display-wonk font-display text-heading-serif text-ink">
              Wonk cut · affirmations
            </p>
            <p className="text-heading-md text-ink">Heading · Nunito 20/700</p>
            <p className="text-heading-sm text-ink">Row title · Nunito 18/700</p>
            <p className="text-body text-ink">Body · Nunito 16/500</p>
            <p className="text-body-sm text-ink-muted">Meta · Nunito 14/500</p>
            <p className="text-label uppercase text-ink-muted">Label · 13/700 · tracked</p>
            <p className="font-display text-countdown tabular text-ink">12:04</p>
          </div>
        </Section>

        <Section title="Surfaces & ink">
          <div className="grid grid-cols-2 gap-3">
            <Swatch name="canvas" className="bg-canvas" />
            <Swatch name="surface" className="bg-surface" />
            <Swatch name="surface-sunken" className="bg-surface-sunken" />
            <Swatch name="surface-field" className="bg-surface-field" />
            <Swatch name="accent" className="bg-accent" />
            <Swatch name="accent-soft" className="bg-accent-soft" />
            <Swatch name="solid" className="bg-solid" />
            <Swatch name="border-strong" className="bg-border-strong" />
          </div>
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-body text-ink">ink — primary</p>
            <p className="text-body text-ink-muted">ink-muted — meta</p>
            <p className="text-body text-ink-subtle">ink-subtle — disabled</p>
          </div>
        </Section>

        <Section title="Category pastels" hint="Theme-invariant — identical in light and dark">
          <div className="flex flex-wrap gap-3">
            {CATS.map((c) => (
              <div key={c} className="flex flex-col items-center gap-1">
                <EmojiChip emoji="🌿" category={c} />
                <span className="text-micro text-ink-muted">{c}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Domain chips" hint="Emoji by default, lucide glyph where emoji would shout">
          <div className="flex flex-wrap gap-3">
            {DOMAINS.map((d) => (
              <DomainIcon key={d} domain={d} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {DOMAINS.map((d) => (
              <DomainIcon key={d} domain={d} variant="glyph" />
            ))}
          </div>
        </Section>

        <Section title="Buttons" hint="solid = the CTA · accent = active / confirm">
          <div className="flex flex-col gap-3">
            <Button variant="solid" className="w-full">
              Begin
            </Button>
            <Button variant="accent" className="w-full">
              Confirm
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="pill">
                Secondary
              </Button>
              <Button variant="outline" size="pill">
                Outline
              </Button>
              <Button variant="ghost" size="pill">
                Ghost
              </Button>
              <Button variant="destructive" size="pill">
                Delete
              </Button>
              <Button variant="link" size="pill">
                Link
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="accent" size="fab">
                <Sparkles />
              </Button>
              <Button variant="solid" size="icon">
                <Home />
              </Button>
              <Button variant="secondary" size="icon-sm">
                <Clock />
              </Button>
              <Button variant="solid" size="lg">
                Large
              </Button>
              <Button variant="solid" size="sm">
                Small
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Rows">
          <div className="flex flex-col gap-3">
            <TaskRow
              leading={<DomainIcon domain="pets" />}
              title="Pay overdue veterinary bill"
              meta={
                <span className="flex items-center gap-1.5">
                  <Pill tone="high" className="px-2 py-0 text-micro">
                    Urgent
                  </Pill>
                  17 days overdue
                </span>
              }
              trailing={
                <CompletionRing checked={done} onChange={setDone} label="Pay veterinary bill" />
              }
            />
            <TaskRow
              leading={<DomainIcon domain="finance" />}
              title="Renew home insurance"
              meta="Friday · 30m"
              trailing={<SelectionCheck checked />}
            />
            <TaskRow
              leading={<EmojiChip emoji="🧾" category="sky" square />}
              title="Electricity bill — March"
              meta="2 pages · 340 KB"
              muted
              trailing={<Toggle checked={on} onChange={setOn} label="Track this bill" />}
            />
          </div>
        </Section>

        <Section title="Section headers">
          <div className="flex flex-wrap gap-2">
            {CHIP_TONES.map((t) => (
              <SectionHeaderChip key={t} label={t} tone={t} count={3} />
            ))}
          </div>
          <div className="mt-3">
            <SectionHeaderChip
              label="Morning"
              tone="morning"
              count={3}
              open={chipOpen}
              onToggle={() => setChipOpen((v) => !v)}
            />
          </div>
        </Section>

        <Section title="Pills">
          <div className="flex flex-wrap gap-2">
            {PILL_TONES.map((t) => (
              <Pill key={t} tone={t}>
                {t}
              </Pill>
            ))}
          </div>
        </Section>

        <Section title="Stats">
          <StatStrip
            stats={[
              { value: 10, label: 'All', tone: 'ink' },
              { value: 3, label: 'Due soon', tone: 'accent' },
              { value: 24, label: 'Resolved', tone: 'muted' },
            ]}
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile value={12} label="Scanned" emoji="📄" />
            <StatTile value="4h" label="Saved" emoji="⏳" tone="muted" />
          </div>
        </Section>

        <Section title="Controls">
          <div className="flex flex-col gap-3">
            <SegmentedControl
              label="Layout"
              value={seg}
              onChange={setSeg}
              segments={[
                { value: 'list', label: 'List' },
                { value: 'board', label: 'Board' },
              ]}
            />
            <Input placeholder="Describe what you're looking for" />
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-sunken">
                <div className="h-full w-2/3 rounded-pill bg-accent" />
              </div>
              <span className="text-body-sm tabular text-ink-muted">4/6</span>
            </div>
            <div className="flex gap-2">
              <ChipToggle selected onClick={() => {}}>
                Selected
              </ChipToggle>
              <ChipToggle selected={false} onClick={() => {}}>
                Unselected
              </ChipToggle>
            </div>
          </div>
        </Section>

        <Section title="Card">
          <Card>
            <CardHeader>
              <CardTitle>You closed the day.</CardTitle>
              <CardDescription>Six matters settled, nothing left waiting on you.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="solid" className="w-full">
                See tomorrow
              </Button>
            </CardContent>
          </Card>
        </Section>

        <Section title="Gradient surfaces" hint="Hero, onboarding, celebration, AI preview only">
          <GradientHero
            className="rounded-2xl py-10"
            variant="celebrate"
            glyph={<EmojiChip emoji="🌤️" category="peach" size={64} tilt />}
            title="All clear."
            subtitle="Nothing else needs your call."
          />
          <div className="bg-ai-gradient mt-3 rounded-2xl p-5">
            <p className="font-display text-heading-serif text-ink">AI preview surface</p>
            <p className="text-body-sm text-ink-muted">Diagonal coral wash, used sparingly.</p>
          </div>
        </Section>

        <Section title="Sheet">
          <Button
            variant="secondary"
            onClick={(e) => {
              setTrigger(e.currentTarget.getBoundingClientRect())
              setSheetOpen(true)
            }}
          >
            Open bottom sheet
          </Button>
        </Section>

        <Section title="Elevation">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-surface p-4 shadow-card">
              <p className="text-body-sm text-ink-muted">card</p>
            </div>
            <div className="rounded-2xl bg-surface p-4 shadow-elevated">
              <p className="text-body-sm text-ink-muted">elevated</p>
            </div>
            <div className="rounded-2xl bg-surface p-4 shadow-halo">
              <p className="text-body-sm text-ink-muted">halo</p>
            </div>
          </div>
        </Section>
      </div>

      <MorphSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        trigger={trigger}
        title="Arrange matters"
        eyebrow="Sheet"
        height={340}
        footer={
          <Button variant="solid" className="w-full" onClick={() => setSheetOpen(false)}>
            Apply
          </Button>
        }
      >
        <SheetSection label="Group by">
          <div className="flex flex-wrap gap-2">
            <ChipToggle selected onClick={() => {}}>
              Time
            </ChipToggle>
            <ChipToggle selected={false} onClick={() => {}}>
              Domain
            </ChipToggle>
            <ChipToggle selected={false} onClick={() => {}}>
              Priority
            </ChipToggle>
          </div>
        </SheetSection>
      </MorphSheet>

      <TabBar active="dashboard" />
    </main>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-label uppercase text-ink-muted">{title}</h2>
        {hint ? <p className="text-body-sm text-ink-subtle">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function Swatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`size-11 shrink-0 rounded-xl shadow-card ${className}`} />
      <span className="min-w-0 truncate text-body-sm text-ink-muted">{name}</span>
    </div>
  )
}
