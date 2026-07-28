'use client'

import { useEffect, useRef } from 'react'

import { cn } from '@/lib/cn'


export const CODE_LENGTH = 6

// Six-box entry for the emailed confirmation code.
//
// The boxes are presentation; the value is one string owned by the caller, so
// there is no per-box state to fall out of sync. Three things make this usable
// on a phone and are easy to leave out:
//   - `autoComplete="one-time-code"` on the first box, so iOS offers the code
//     from the notification banner instead of making the user switch apps.
//   - Paste of the whole code fills every box, because people paste.
//   - Backspace on an empty box steps back, because otherwise a typo traps you.

export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = false,
  invalid = false,
  className,
}: {
  value: string
  onChange: (next: string) => void
  /** Fired once the last digit lands — saves a tap on the confirm button. */
  onComplete?: (code: string) => void
  disabled?: boolean
  autoFocus?: boolean
  invalid?: boolean
  className?: string
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = value.padEnd(CODE_LENGTH, ' ').slice(0, CODE_LENGTH).split('')

  useEffect(() => {
    // preventScroll: focusing normally scrolls the sheet's body to this row and
    // hides the "we sent a code to…" line that explains what to type.
    if (autoFocus) refs.current[0]?.focus({ preventScroll: true })
  }, [autoFocus])

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, CODE_LENGTH)
    onChange(clean)
    if (clean.length === CODE_LENGTH) {
      refs.current[CODE_LENGTH - 1]?.blur()
      onComplete?.(clean)
    }
    return clean
  }

  const handleInput = (index: number, raw: string) => {
    // A paste lands in one box as the whole code — spread it rather than
    // taking the first character and silently dropping the rest.
    if (raw.length > 1) {
      const clean = commit(raw)
      refs.current[Math.min(clean.length, CODE_LENGTH - 1)]?.focus()
      return
    }
    const digit = raw.replace(/\D/g, '')
    if (!digit) return
    const next = value.padEnd(CODE_LENGTH, ' ').split('')
    next[index] = digit
    commit(next.join('').replace(/ /g, ''))
    refs.current[Math.min(index + 1, CODE_LENGTH - 1)]?.focus()
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index]?.trim() && index > 0) {
      e.preventDefault()
      onChange(value.slice(0, index - 1))
      refs.current[index - 1]?.focus()
      return
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus()
    if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) refs.current[index + 1]?.focus()
  }

  return (
    <div
      className={cn('flex justify-between gap-2', className)}
      role="group"
      aria-label="Confirmation code"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node
          }}
          value={digit.trim()}
          onChange={(e) => handleInput(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onFocus={(e) => e.currentTarget.select()}
          disabled={disabled}
          inputMode="numeric"
          // Only the first box advertises the OTP, or iOS offers autofill on
          // every box and pastes the whole code into each one.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={CODE_LENGTH}
          aria-label={`Digit ${index + 1}`}
          aria-invalid={invalid || undefined}
          className={cn(
            'h-13 w-full min-w-0 rounded-xl bg-surface-field text-center font-display text-heading-xl text-ink tabular outline-none transition-colors',
            'focus-visible:ring-3 focus-visible:ring-ring/40',
            'disabled:cursor-not-allowed disabled:opacity-50',
            invalid && 'ring-3 ring-destructive/25',
          )}
        />
      ))}
    </div>
  )
}
