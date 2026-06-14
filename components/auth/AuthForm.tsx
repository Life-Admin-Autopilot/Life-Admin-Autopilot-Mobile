'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSignIn, useSignUp } from '@/queries/auth'
import { signInSchema, signUpSchema, type SignInValues } from '@/schemas/auth'
import { translateBackendError } from '@/lib/translateBackendError'

const COPY = {
  signin: {
    title: 'Welcome back.',
    subtitle: 'Sign in to continue.',
    submit: 'Sign in',
    switchText: 'New here?',
    switchCta: 'Create an account',
    switchHref: '/sign-up',
  },
  signup: {
    title: 'Create your account.',
    subtitle: 'Mo keeps your life admin in order.',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchCta: 'Sign in',
    switchHref: '/sign-in',
  },
} as const

// Shared email + password form for sign-in and sign-up. On success the session
// store is hydrated and the (auth) RouteGuard routes onward (→ /onboarding or
// /dashboard). Both mutations are created unconditionally (rules of hooks).
export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const copy = COPY[mode]
  const [reveal, setReveal] = useState(false)

  const signUp = useSignUp()
  const signIn = useSignIn()
  const mutation = mode === 'signup' ? signUp : signIn

  // Both schemas share the SignInValues shape (email + password).
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInValues>({
    resolver: zodResolver(mode === 'signup' ? signUpSchema : signInSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = (values: SignInValues) => {
    mutation.mutate(values)
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-display-md text-ink">{copy.title}</h1>
        <p className="text-body text-ink-muted">{copy.subtitle}</p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <Field label="Email" error={errors.email?.message}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
        </Field>

        <Field label="Password" error={errors.password?.message}>
          <div className="relative">
            <Input
              type={reveal ? 'text' : 'password'}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
              aria-invalid={!!errors.password}
              className="pr-10"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 grid w-10 place-items-center text-ink-subtle"
            >
              {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        {mutation.isError ? (
          <p role="alert" className="text-body-sm text-danger">
            {translateBackendError(mutation.error)}
          </p>
        ) : null}

        <Button type="submit" disabled={mutation.isPending} className="mt-2 h-12 w-full">
          {mutation.isPending ? 'One moment…' : copy.submit}
        </Button>
      </form>

      <p className="text-center text-body-sm text-ink-muted">
        {copy.switchText}{' '}
        <Link href={copy.switchHref} className="text-accent">
          {copy.switchCta}
        </Link>
      </p>
    </main>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-body-sm text-ink-muted">{label}</span>
      {children}
      {error ? <span className="text-caption text-danger">{error}</span> : null}
    </label>
  )
}
