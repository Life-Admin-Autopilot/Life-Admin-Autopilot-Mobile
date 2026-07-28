'use client'

import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { useSignIn, useSignUp } from '@/queries/auth'
import { signInSchema, signUpSchema, type SignInValues } from '@/schemas/auth'
import { translateBackendError } from '@/lib/translateBackendError'
import { env } from '@/lib/env'

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
    subtitle: `${env.appName} keeps your life admin in order.`,
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
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-display-hero text-balance text-ink">{copy.title}</h1>
        <p className="text-body text-ink-muted">{copy.subtitle}</p>
      </header>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
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
          <PasswordInput
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
            aria-invalid={!!errors.password}
            {...register('password')}
          />
        </Field>

        {mutation.isError ? (
          <p role="alert" className="text-body-sm text-danger">
            {translateBackendError(mutation.error)}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="solid"
          size="lg"
          disabled={mutation.isPending}
          className="mt-2 w-full"
        >
          {mutation.isPending ? 'One moment…' : copy.submit}
        </Button>
      </form>

      <p className="text-center text-body text-ink-muted">
        {copy.switchText}{' '}
        <Link href={copy.switchHref} className="font-bold text-accent">
          {copy.switchCta}
        </Link>
      </p>
    </main>
  )
}
