'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useHealth } from '@/queries/health'

// Backend health probe — proves the full client seam (env → baseUrl → api client
// → CORS → Express). Renders all three async states per AGENTS.md. Moved off `/`
// so the home route can host the design-system styleguide.
export default function HealthPage() {
  const { data, isLoading, error, refetch, isFetching } = useHealth()

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-1">
        <span className="text-label uppercase text-ink-subtle">Mo V2 · foundation</span>
        <h1 className="font-display text-display-hero text-ink">Backend reachable?</h1>
        <p className="text-body text-ink-muted">
          End-to-end check against{' '}
          <code className="rounded-sm bg-surface-sunken px-1.5 py-0.5 text-body-sm">/health</code>.
        </p>
      </header>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="font-display text-heading-md">Status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isLoading ? (
            <div className="flex animate-pulse flex-col gap-3" aria-hidden>
              <div className="h-5 rounded-sm bg-surface-sunken" />
              <div className="h-5 w-2/3 rounded-sm bg-surface-sunken" />
              <div className="h-5 w-1/2 rounded-sm bg-surface-sunken" />
            </div>
          ) : error ? (
            <div className="flex flex-col gap-3">
              <p className="text-body text-danger">
                Backend unreachable. Is <code className="text-body-sm">npm run dev</code> running in{' '}
                <code className="text-body-sm">server/</code>?
              </p>
              <Button onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? 'Retrying…' : 'Retry'}
              </Button>
            </div>
          ) : (
            <dl className="flex flex-col gap-2">
              <Row label="status" value={data?.status ?? '—'} accent={data?.status === 'ok'} />
              <Row label="db" value={data?.db ?? '—'} accent={data?.db === 'connected'} />
              <Row label="uptime" value={data ? `${Math.round(data.uptime)}s` : '—'} />
            </dl>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-body-sm text-ink-muted">{label}</dt>
      <dd
        className={
          accent
            ? 'rounded-pill bg-accent-soft px-2.5 py-0.5 text-body-sm text-accent tabular'
            : 'text-body-sm text-ink tabular'
        }
      >
        {value}
      </dd>
    </div>
  )
}
