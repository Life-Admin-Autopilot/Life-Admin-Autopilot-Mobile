'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'

// Cycles light → dark, mirroring the resolved (system-aware) theme.
// Renders nothing until mounted to avoid a hydration mismatch.
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return <div className="size-[22px]" aria-hidden />

  const isDark = resolvedTheme === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="block text-ink-muted transition-colors hover:text-ink"
    >
      {/* {isDark ? <Sun size={22} /> : <Moon size={22} />} */}
    </button>
  )
}
