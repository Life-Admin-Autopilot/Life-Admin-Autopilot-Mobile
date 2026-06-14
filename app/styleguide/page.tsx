import Image from 'next/image'
import {
  Menu,
  Bell,
  ChevronRight,
  FileText,
  ShieldCheck,
  ArrowUpRight,
  LayoutGrid,
  ListChecks,
  User,
} from 'lucide-react'

import kingImg from '@/assets/brand/king1.png'
import { Plus } from '@/components/icons/Plus'
import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { MorphDemo } from '@/components/showcase/MorphDemo'
import { ChatbotPopup } from '@/components/showcase/ChatbotPopup'
import { VoiceRecordPopup } from '@/components/showcase/VoiceRecordPopup'
import { MorphMenuDemo } from '@/components/showcase/MorphMenuDemo'
import { MorphToastDemo } from '@/components/showcase/MorphToastDemo'

// Design-system styleguide — the "white marble + crimson" silent sovereign made
// visible. Static preview; no backend. Lives at /styleguide; / is the app gate.
export default function StyleguidePage() {
  return (
    <main className="min-h-dvh pb-28">
      <AppBar />
      <Hero />

      <div className="mx-auto flex max-w-md flex-col gap-12 px-6 py-12">
        <Section eyebrow="Components" title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Create matter</Button>
            <Button variant="secondary">Attach document</Button>
            <Button variant="outline">Secondary</Button>
            <Button variant="ghost">Skip</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="link">Open document</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
            <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-ink shadow-elevated">
              <Plus size={22} className="text-accent-ink" />
            </span>
          </div>
        </Section>

        <Section eyebrow="Motion" title="Dynamic Island morph">
          <p className="text-caption text-ink-subtle">
            The one core animation — ported verbatim from Wiscord. Tap the pill below, or the
            floating crimson buttons (assistant, bottom-right · voice, bottom-left).
          </p>
          <MorphDemo />
        </Section>

        <Section eyebrow="Motion" title="Dropdown">
          <p className="text-caption text-ink-subtle">
            The menu drops out of the trigger with the same spring + content fade.
          </p>
          <MorphMenuDemo />
        </Section>

        <Section eyebrow="Motion" title="Toast">
          <p className="text-caption text-ink-subtle">
            A pill grows into the notification — same morph, via <code>lib/toast.ts</code>. Page
            transitions use it too (navigate to <code>/health</code> and back).
          </p>
          <MorphToastDemo />
        </Section>

        <Section eyebrow="Material" title="Surfaces & depth">
          <div className="grid grid-cols-2 gap-3">
            <Swatch label="canvas" className="bg-canvas border border-border" />
            <Swatch label="surface" className="bg-surface border border-border" />
            <Swatch label="surface-sunken" className="bg-surface-sunken" />
            <Swatch label="border-strong" className="bg-surface border-2 border-border-strong" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
              <p className="text-body-sm text-ink-muted">shadow-card</p>
              <p className="text-caption text-ink-subtle">a whisper on marble</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4 shadow-elevated">
              <p className="text-body-sm text-ink-muted">shadow-elevated</p>
              <p className="text-caption text-ink-subtle">sheets & modals</p>
            </div>
          </div>
        </Section>

        <Section eyebrow="Pattern" title="Matters">
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            <MatterRow domain="car" title="Car Insurance Renewal" due="Due today · 10:00 AM" overdue />
            <Divider />
            <MatterRow domain="finance" title="Credit Card Payment" due="Due today · 6:00 PM" />
            <Divider />
            <MatterRow
              domain="home"
              title="Home Insurance Renewal"
              due="Due in 8 days · May 20"
              icon={<ShieldCheck size={18} className="text-ink-subtle" />}
            />
          </div>
        </Section>

        <Section eyebrow="Trust" title="Citation">
          <p className="text-body text-ink">
            Renewal date extracted from the policy.{' '}
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 align-middle text-caption text-ink-muted shadow-card">
              <FileText size={12} className="text-accent" />
              policy.pdf · p.2
              <ArrowUpRight size={11} className="text-ink-subtle" />
            </span>
          </p>
          <p className="text-caption text-ink-subtle">
            Required wherever the system surfaces an extracted value.
          </p>
        </Section>

        <Section eyebrow="Type" title="Typography">
          <div className="flex flex-col gap-3 border-l-2 border-border-strong pl-4">
            <p className="font-wordmark text-wordmark text-ink">AUTOPILOT</p>
            <p className="font-display text-display-hero text-ink">Good morning, Alex.</p>
            <p className="font-display text-display-md text-ink">Order, restored.</p>
            <p className="font-display text-heading-xl text-ink">Section title</p>
            <p className="text-heading-sm text-ink">Row title — Inter SemiBold</p>
            <p className="text-body text-ink-muted">
              Body — Inter. The system states facts, reports status, executes requests.
            </p>
            <p className="text-label uppercase text-ink-subtle">Due today</p>
          </div>
        </Section>

        <Section eyebrow="Tokens" title="Color">
          <div className="grid grid-cols-3 gap-3">
            <Swatch label="canvas" className="bg-canvas border border-border" small />
            <Swatch label="surface" className="bg-surface border border-border" small />
            <Swatch label="ink" className="bg-ink" small />
            <Swatch label="accent" className="bg-accent" small />
            <Swatch label="accent-soft" className="bg-accent-soft" small />
            <Swatch label="gold" className="bg-gold" small />
            <Swatch label="danger" className="bg-danger" small />
            <Swatch label="warning" className="bg-warning" small />
            <Swatch label="ink-muted" className="bg-ink-muted" small />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {(['health', 'home', 'car', 'finance', 'family', 'pets'] as Domain[]).map((d) => (
              <DomainIcon key={d} domain={d} size={32} />
            ))}
          </div>
        </Section>
      </div>

      <TabBarPreview />
      <ChatbotPopup />
      <VoiceRecordPopup />
    </main>
  )
}

/* ---------------- sections ---------------- */

function AppBar() {
  return (
    <header className="flex items-center justify-between px-6 pt-6">
      <Menu size={22} className="text-ink-muted" />
      <div className="flex flex-col items-center gap-1">
        <Plus size={16} />
        <span className="text-label uppercase text-ink-subtle">Life Admin</span>
        <span className="font-wordmark text-wordmark leading-none text-ink">AUTOPILOT</span>
      </div>
      <span className="relative">
        <Bell size={22} className="text-ink-muted" />
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-accent" />
      </span>
    </header>
  )
}

function Hero() {
  return (
    <section className="flex flex-col items-center px-6 pt-6 text-center">
      <div className="flex w-full justify-center bg-transparent pt-2">
        <Image
          src={kingImg}
          alt="The silent sovereign — a weathered marble king on a throne"
          priority
          className="h-64 w-auto object-contain mix-blend-darken"
          style={{ scale: '1.5', position: 'relative', top: '-7px' }}
        />
      </div>
      <h1 className="mt-4 font-display text-display-hero text-ink">Good morning, Alex.</h1>
      <p className="mt-1 text-body text-ink-muted">
        <span className="text-accent">5 matters</span> require attention.
      </p>

      <div className="mt-3 grid w-full grid-cols-3 gap-3 pt-1">
        <Stat n="8" label="All matters" />
        <Stat n="5" label="Due soon" />
        <Stat n="3" label="Resolved" muted />
      </div>
    </section>
  )
}

function Stat({ n, label, muted }: { n: string; label: string; muted?: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-lg">
      <span
        className={`font-display text-display-md tabular ${muted ? 'text-ink-muted' : 'text-accent'}`}
      >
        {n}
      </span>
      <span className="text-caption text-ink-muted">{label}</span>
    </div>
  )
}

function MatterRow({
  domain,
  title,
  due,
  overdue,
  icon,
}: {
  domain: Domain
  title: string
  due: string
  overdue?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <DomainIcon domain={domain} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-heading-sm text-ink">{title}</span>
        <span className="text-caption tabular text-accent">{due}</span>
      </div>
      {overdue ? (
        <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-micro uppercase text-accent">
          Overdue
        </span>
      ) : (
        (icon ?? <ChevronRight size={18} className="text-ink-subtle" />)
      )}
    </div>
  )
}

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3">
        <span className="text-label uppercase text-accent">{eyebrow}</span>
        <span className="h-px flex-1 bg-border" />
        <h2 className="font-display text-heading-xl text-ink">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function Swatch({ label, className, small }: { label: string; className: string; small?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className={`${small ? 'h-12' : 'h-16'} rounded-md ${className}`} />
      <span className="text-micro text-ink-muted">{label}</span>
    </div>
  )
}

function Divider() {
  return <div className="mx-4 h-px bg-border" />
}

function TabBarPreview() {
  return (
    <nav className="fixed inset-x-0 bottom-4 z-10 mx-auto flex max-w-sm items-center justify-around rounded-pill border border-border bg-surface/90 px-2 py-2 shadow-elevated backdrop-blur">
      <Tab icon={<LayoutGrid size={22} />} label="Dashboard" active />
      <Tab icon={<ListChecks size={22} />} label="Matters" />
      <span className="grid size-12 -translate-y-3 place-items-center rounded-full bg-accent text-accent-ink shadow-elevated">
        <Plus size={22} className="text-accent-ink" />
      </span>
      <Tab icon={<FileText size={22} />} label="Documents" />
      <Tab icon={<User size={22} />} label="Profile" />
    </nav>
  )
}

function Tab({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <span
      className={`flex w-14 flex-col items-center gap-0.5 ${active ? 'text-accent' : 'text-ink-subtle'}`}
    >
      {icon}
      <span className="text-micro">{label}</span>
    </span>
  )
}
