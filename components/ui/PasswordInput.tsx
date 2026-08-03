'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useTranslations } from 'next-intl'
import * as React from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

// Password field with a reveal toggle. The reveal matters more on a phone than
// on a desktop — a mistyped character in a password you cannot see is the most
// common reason a correct password gets rejected on a soft keyboard.
//
// `forwardRef` so react-hook-form's `register()` can attach to the real input.
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<'input'>, 'type'>
>(function PasswordInput({ className, ...props }, ref) {
  const t = useTranslations('ui.password')
  const [reveal, setReveal] = React.useState(false)

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={reveal ? 'text' : 'password'}
        className={cn('pe-12', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        aria-label={reveal ? t('hide') : t('show')}
        className="absolute inset-y-0 end-0 grid w-12 place-items-center text-ink-muted transition-colors hover:text-ink"
      >
        {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
})
