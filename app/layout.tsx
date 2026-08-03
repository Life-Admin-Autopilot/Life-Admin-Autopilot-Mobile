import type { Metadata, Viewport } from 'next'
import { Fraunces, IBM_Plex_Sans_Arabic, Nunito } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { env } from '@/lib/env'
import { DEFAULT_LOCALE, directionOf } from '@/lib/i18n/locales'
import enAuth from '@/lib/i18n/messages/en/auth.json'
import { localePrePaintScript } from '@/lib/i18n/prePaintScript'

// Soft-planner type system (docs/tokens.md):
//   Fraunces — display: high-contrast editorial serif for hero/day/affirmation
//   Nunito   — body, rows, labels, data: rounded, friendly, tall x-height
// Exposed under neutral variable names and re-mapped to --font-display /
// --font-sans in globals.css. The indirection matters: naming the next/font
// variable --font-display directly would make the @theme mapping
// `--font-display: var(--font-display)` reference itself.
//
// `adjustFontFallback: false` on both, and it is load-bearing for Arabic rather
// than a performance choice. By default next/font appends a metric-matched
// fallback face to the variable, so `--font-nunito` expands to
// `"Nunito", "Nunito Fallback"` — and that fallback is `src: local(Arial)`
// (Fraunces gets Times New Roman). Arial and Times both carry FULL Arabic on
// Apple platforms, so every Arabic character was claimed by the Latin font's own
// fallback and never reached the Arabic slot of the stack at all. The Arabic face
// in globals.css was unreachable behind it no matter what that face was.
//
// Turning it off costs the metric-matched swap for Latin: a first paint before
// the webfont lands now reflows slightly rather than not at all. That is a real
// but small CLS cost on one paint, and the alternative is the app rendering
// Arabic in Arial permanently.
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['SOFT', 'WONK', 'opsz'],
  variable: '--font-fraunces',
  display: 'swap',
  adjustFontFallback: false,
})

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
  adjustFontFallback: false,
})

// Arabic fallback. Neither Fraunces nor Nunito carries a single Arabic glyph,
// so without this every Arabic string would land on whatever the platform
// picked — Times-ish on Android, inconsistent on desktop.
//
// This is the FALLBACK, not the first choice: globals.css puts `-apple-system`
// ahead of it, so on iOS and macOS the system's SF Arabic wins and this file is
// never downloaded. Apple's licence forbids redistributing SF as a webfont, so
// the system font can only be reached by keyword — never by name, and never via
// local(), which WebKit does not expose Apple's faces through. A real OFL face
// therefore has to exist behind it for Android and every non-Apple browser.
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

// The description is English, and not by omission. `metadata` is evaluated
// once at build time and `output: 'export'` emits ONE set of HTML that both
// languages boot from — there is no request, no locale, nothing to negotiate
// against, and it is read by crawlers and share sheets before a locale exists.
// So it is sourced from the reference catalogue rather than retyped: the creed
// keeps one home, the same two keys the welcome screen renders translated.
export const metadata: Metadata = {
  title: env.appName,
  description: `${enAuth.welcome.speakOnce} ${enAuth.welcome.orderFollows}`,
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
