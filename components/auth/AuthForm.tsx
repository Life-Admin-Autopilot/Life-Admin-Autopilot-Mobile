'use client'

import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { useSignIn, useSignUp } from '@/queries/auth'
import { signInSchema, signUpSchema, type SignInValues } from '@/schemas/auth'
import { translateBackendError } from '@/lib/translateBackendError'
import { env } from '@/lib/env'

/**
 * Mirrors `signUpSchema` in schemas/auth.ts. The placeholder states the rule
 * the schema enforces, and it is a `{count}` rather than a baked-in "8" so the
 * Arabic reads with the right plural — 8 characters is `أحرف`, 1 is `حرف واحد`,
 * 2 is `حرفان`, and no ternary can produce all six.
 */
const MIN_PASSWORD_LENGTH = 8

// Shared email + password form for sign-in and sign-up. On success the session
// store is hydrated and the (auth) RouteGuard routes onward (→ /onboarding or
// /dashboard). Both mutations are created unconditionally (rules of hooks).
//
// The copy used to be a module-level COPY const keyed by mode. It cannot be
// any more: resolving it needs `useTranslations`, and a module const is
// evaluated long before any component runs. So the two variants are built HERE
// instead, each branch naming its keys as literals. Deriving the namespace from
// `mode` and interpolating it into the key would be shorter and strictly worse:
// only literal keys are checked against the catalogue, so a typo or a key
// dropped from one of the two blocks would then reach a user as `auth.signUp.title`.
export function AuthForm({ mode }: { mode: 'signin' | 'signup' }) {
  const t = useTranslations('auth')
  const tProfile = useTranslations('profile')

  const copy =
    mode === 'signup'
      ? {
          title: t('signUp.title'),
          subtitle: t('signUp.subtitle', { app: env.appName }),
          submit: t('signUp.submit'),
          switchText: t('signUp.switchText'),
          switchCta: t('signUp.switchCta'),
          switchHref: '/sign-in',
        }
      : {
          title: t('signIn.title'),
          subtitle: t('signIn.subtitle'),
          submit: t('signIn.submit'),
          switchText: t('signIn.switchText'),
          switchCta: t('signIn.switchCta'),
          switchHref: '/sign-up',
        }

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
        {/* The email placeholder is an example address, not prose — identical
            in both languages. Borrowed from the change-email sheet rather than
            duplicated here: that key is already on the catalogue check's
            same-in-both-languages list, and a second copy would either trip the
            check or need its own exemption. */}
        <Field label={t('emailLabel')} error={errors.email?.message}>
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder={tProfile('email.placeholder')}
            aria-invalid={!!errors.email}
            {...register('email')}
          />
        </Field>

        <Field label={t('passwordLabel')} error={errors.password?.message}>
          <PasswordInput
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={
              mode === 'signup'
                ? t('newPasswordPlaceholder', { count: MIN_PASSWORD_LENGTH })
                : t('passwordPlaceholder')
            }
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
          {mutation.isPending ? t('oneMoment') : copy.submit}
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
