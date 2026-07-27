'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

// Cycles light → dark, mirroring the resolved (system-aware) theme.
// Renders a same-size placeholder until mounted to avoid a hydration mismatch
// and to keep the header from reflowing on first paint.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="size-11" aria-hidden />

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="grid size-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      {isDark ? <Sun size={20} strokeWidth={1.75} /> : <Moon size={20} strokeWidth={1.75} />}
    </button>
  )
}
