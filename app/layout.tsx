import type { Metadata, Viewport } from 'next'
import { Fraunces, IBM_Plex_Sans_Arabic, Nunito } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { env } from '@/lib/env'
import { DEFAULT_LOCALE, directionOf } from '@/lib/i18n/locales'
import { localePrePaintScript } from '@/lib/i18n/prePaintScript'

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

// Arabic fallback. Neither Fraunces nor Nunito carries a single Arabic glyph,
// so without this every Arabic string would land on whatever the platform
// picked — Times-ish on Android, inconsistent on desktop.
//
// This is the FALLBACK, not the first choice: globals.css puts a local-only
// 'SFArabic' face ahead of it, so on iOS the system's SF Arabic wins and this
// file is never downloaded. Apple's licence forbids redistributing SF Arabic as
// a webfont, which is why it can only be reached via local() and why a real
// OFL face has to exist behind it for Android and the browser.
//
// 800 is absent from the family (it stops at 700), so --text-wordmark's 800
// resolves to 700 in Arabic. That is the correct degradation: a synthesised
// 800 would smear the joins on a connected script.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
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
    // lang/dir carry the build-time default only. The pre-paint script below
    // overwrites both from the stored choice before the first frame, and
    // LocaleProvider re-asserts them after hydration — so React must not be
    // allowed to complain about the mismatch it will always see here.
    <html
      lang={DEFAULT_LOCALE}
      dir={directionOf(DEFAULT_LOCALE)}
      className={`${fraunces.variable} ${nunito.variable} ${plexArabic.variable} h-full`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: localePrePaintScript() }} />
      </head>
      <body className="min-h-dvh bg-canvas">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
