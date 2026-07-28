'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

import { AppHeader } from '@/components/layout/AppHeader'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { PREVIEW_STATES } from './fixtures'

// Dashboard state gallery — every state the home screen can be in, driven by
// fixtures.
//
// It renders the REAL `DashboardView`, not a rebuilt copy, so it cannot drift
// away from production: any change to the dashboard shows up here on the next
// reload, and a state that looks broken here is broken for users too.
//
// Deep-linkable via `?state=<slug>`; `?state=all` stacks every state for a
// single scroll-through. Dev-only route (the zz- prefix keeps it sorted out of
// the way); nothing in the app links to it.
export default function PreviewDashboardPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const [active, setActive] = useState<string>('all')

  // Read the deep link after mount. Reading search params during render would
  // desync the static prerender from the client's first paint.
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('state')
    if (slug) setActive(slug)
  }, [])

  const select = (slug: string) => {
    setActive(slug)
    const url = new URL(window.location.href)
    url.searchParams.set('state', slug)
    window.history.replaceState(null, '', url)
  }

  const shown = active === 'all' ? PREVIEW_STATES : PREVIEW_STATES.filter((s) => s.slug === active)
  const isDark = resolvedTheme === 'dark'

  return (
    <main className="min-h-dvh bg-canvas pb-24">
      <header className="sticky top-0 z-30 flex flex-col gap-3 bg-canvas/95 px-5 pb-3 pt-5 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-heading-serif text-ink">Dashboard states</span>
          <Button
            variant="secondary"
            size="pill"
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? <Sun /> : <Moon />}
            {isDark ? 'Light' : 'Dark'}
          </Button>
        </div>

        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {[{ slug: 'all', label: 'All' }, ...PREVIEW_STATES].map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => select(s.slug)}
              className={cn(
                'shrink-0 rounded-pill px-3.5 py-2 text-body-sm font-bold transition-colors',
                active === s.slug ? 'bg-accent text-accent-ink' : 'bg-surface-field text-ink',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-col gap-10 pt-4">
        {shown.map((state) => {
          // Each state gets its own `now`, resolved at render, so every
          // relative time in the fixtures stays honest.
          const now = new Date()
          const props = state.build(now)
          return (
            <section key={state.slug} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5 px-5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h2 className="text-label uppercase text-ink-muted">{state.label}</h2>
                  <code className="text-micro text-ink-subtle">?state={state.slug}</code>
                </div>
                <p className="text-body-sm text-ink-subtle">{state.note}</p>
              </div>

              <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-3xl bg-canvas py-4 shadow-card ring-1 ring-border">
                <AppHeader />
                <DashboardView
                  {...props}
                  now={now}
                  onComplete={() => {}}
                  onCompleteSubtask={() => {}}
                  onPush={() => {}}
                />
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
