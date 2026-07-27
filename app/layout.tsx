import type { Metadata, Viewport } from 'next'
import { Fraunces, Nunito } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { env } from '@/lib/env'

// Soft-planner type system (docs/tokens.md):
//   Fraunces — display: high-contrast editorial serif for hero/day/affirmation
//   Nunito   — body, rows, labels, data: rounded, friendly, tall x-height
// Exposed under neutral variable names and re-mapped to --font-display /
// --font-sans in globals.css. The indirection matters: naming the next/font
// variable --font-display directly would make the @theme mapping
// `--font-display: var(--font-display)` reference itself.
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
})

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
})

export const metadata: Metadata = {
  title: env.appName,
  description: 'Speak once. Order follows.',
}

// viewport-fit=cover exposes env(safe-area-inset-*) inside the Capacitor shell,
// which the floating tab bar and action bars offset against.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${nunito.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-canvas">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
