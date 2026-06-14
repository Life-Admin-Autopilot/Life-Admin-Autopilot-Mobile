import type { Metadata } from 'next'
import { Cinzel, Cormorant_Garamond, Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

// "White marble + crimson" type system (docs/tokens.md):
//   Cinzel    — the wordmark only (Trajan-style caps)
//   Cormorant — serif display: greetings, section titles
//   Inter     — body, rows, labels, data (tabular numerals)
// Exposed as CSS variables, mapped to --font-wordmark/display/sans in globals.
const cinzel = Cinzel({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-cinzel',
  display: 'swap',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-cormorant',
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
      className={`${cinzel.variable} ${cormorant.variable} ${inter.variable} h-full`}
    >
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
