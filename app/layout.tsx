import type { Metadata } from 'next'
import { Comfortaa, Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

// Lavender + panda type system (docs/tokens.md):
//   Comfortaa — wordmark + display: rounded, friendly, hand-drawn feel
//   Inter     — body, rows, labels, data (tabular numerals)
// Exposed as CSS variables, mapped to --font-wordmark/display/sans in globals.
const comfortaa = Comfortaa({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-comfortaa',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Life Admin Autopilot',
  description: 'Speak once. Order follows.',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${comfortaa.variable} ${inter.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-canvas">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
