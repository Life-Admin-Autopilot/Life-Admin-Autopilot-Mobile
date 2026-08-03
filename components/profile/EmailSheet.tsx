'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { CodeInput, CODE_LENGTH } from '@/components/ui/CodeInput'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Sheet } from '@/components/ui/Sheet'
import { useAutoFocus } from '@/hooks/useAutoFocus'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import type { AuthUser } from '@/lib/auth/sessionStore'
import { toast } from '@/lib/toast'
import { reauthMessages, translateBackendError } from '@/lib/translateBackendError'
import {
  useCancelEmailChange,
  useConfirmEmailChange,
  useConfirmVerificationCode,
  useRequestEmailChange,
  useSendVerificationCode,
} from '@/queries/email'

// Email, in one sheet with two jobs: confirming the address you already have,
// and moving to a new one. Both end at the same six-digit code, so they share
// the code step rather than duplicating it.
//
// Why a code and not a link: the native shell registers no URL scheme yet
// (docs/CAPACITOR.md), so a mailed `lifeadmin://` link opens nothing. A code
// works the same in the browser and in the app, today.

export type EmailSheetMode = 'verify' | 'change'

type Step = 'form' | 'code'

export function EmailSheet({
  open,
  onClose,
  trigger,
  mode,
  user,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  mode: EmailSheetMode
  user: AuthUser
}) {
  const t = useTranslations('profile.email')
  const tProfile = useTranslations('profile')
  const tGroups = useTranslations('profile.groups')
  const [step, setStep] = useState<Step>('form')
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')

  const focusEmail = useAutoFocus<HTMLInputElement>(open && step === 'form')

  const sendVerification = useSendVerificationCode()
  const confirmVerification = useConfirmVerificationCode()
  const requestChange = useRequestEmailChange()
  const confirmChange = useConfirmEmailChange()
  const cancelChange = useCancelEmailChange()

  // An account with a password must re-confirm it before its sign-in address
  // moves; a magic-link-only account has none to give.
  const needsPassword = mode === 'change'

  useResetOnOpen(open, () => {
    setNewEmail('')
    setPassword('')
    setCode('')
    // Reopening while a change is already pending should land on the code step
    // — the user has the email in front of them, not a form to refill.
    setStep(mode === 'verify' || user.pendingEmail ? 'code' : 'form')
  })

  // NOTE: the verification code is sent by the CALLER, in the click handler
  // that opens this sheet in `verify` mode — not from an effect here. Sending
  // an email is a side effect of a user pressing a button, and firing it from
  // a render pass means a re-render for any other reason can mail a second one.

  const targetAddress = mode === 'verify' ? user.email : (user.pendingEmail ?? newEmail)

  const submitForm = () => {
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed) return
    requestChange.mutate(
      { newEmail: trimmed, password: password || undefined },
      {
        onSuccess: () => {
          setStep('code')
          setPassword('')
        },
        onError: (err) =>
          toast.error(translateBackendError(err, t('didntWork'), reauthMessages())),
      },
    )
  }

  const submitCode = (value: string) => {
    if (value.length !== CODE_LENGTH) return
    const onError = (err: unknown) => {
      setCode('')
      toast.error(translateBackendError(err, t('codeRejected')))
    }

    if (mode === 'verify') {
      confirmVerification.mutate(value, {
        onSuccess: () => {
          toast.success(t('confirmed'))
          onClose()
        },
        onError,
      })
      return
    }

    confirmChange.mutate(value, {
      onSuccess: (data) => {
        toast.success(t('changed', { email: data.user.email }))
        onClose()
      },
      onError,
    })
  }

  const resend = () => {
    if (mode === 'verify') {
      sendVerification.mutate(undefined, {
        onSuccess: () => toast.info(t('codeSent')),
        onError: (err) => toast.error(translateBackendError(err, tProfile('codeFailed'))),
      })
      return
    }
    // A change resend re-runs the request with the address already stored, so
    // the user does not retype it (or their password).
    const address = user.pendingEmail ?? newEmail.trim().toLowerCase()
    if (!address) return
    requestChange.mutate(
      { newEmail: address },
      {
        onSuccess: () => toast.info(t('codeSent')),
        onError: (err) =>
          toast.error(translateBackendError(err, tProfile('codeFailed'), reauthMessages())),
      },
    )
  }

  const abandon = () => {
    cancelChange.mutate(undefined, {
      onSuccess: () => {
        toast.info(t('cancelled'))
        onClose()
      },
      onError: (err) => toast.error(translateBackendError(err, t('notCancelled'))),
    })
  }

  const confirming = confirmVerification.isPending || confirmChange.isPending
  const sending = sendVerification.isPending || requestChange.isPending

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={step === 'code' ? 400 : 420}
      eyebrow={tGroups('account')}
      title={mode === 'verify' ? t('verifyTitle') : t('changeTitle')}
      footer={
        step === 'form' ? (
          <Button
            variant="solid"
            className="w-full"
            disabled={!newEmail.trim() || (needsPassword && !password) || sending}
            onClick={submitForm}
          >
            {sending ? t('sending') : t('sendCode')}
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="solid"
              className="w-full"
              disabled={code.length !== CODE_LENGTH || confirming}
              onClick={() => submitCode(code)}
            >
              {confirming ? t('checking') : t('confirm')}
            </Button>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={resend}
                disabled={sending}
                className="rounded-pill px-3 py-1.5 text-caption text-accent hover:bg-accent-soft disabled:opacity-50"
              >
                {sending ? t('sending') : t('sendNewCode')}
              </button>
              {mode === 'change' && user.pendingEmail ? (
                <button
                  type="button"
                  onClick={abandon}
                  disabled={cancelChange.isPending}
                  className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
                >
                  Cancel change
                </button>
              ) : null}
            </div>
          </div>
        )
      }
    >
      {step === 'form' ? (
        <div className="flex flex-col gap-5">
          <Field label={t('newLabel')} hint={t('currentHint', { email: user.email })}>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              // Not `autoFocus`: that scrolls the sheet's body to the input and
              // hides this field's own label. See useAutoFocus.
              ref={focusEmail}
              placeholder={t('placeholder')}
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </Field>

          {needsPassword ? (
            <Field label={t('passwordLabel')} hint={t('passwordHint')}>
              <PasswordInput
                autoComplete="current-password"
                placeholder={t('passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-muted">
            We sent a 6-digit code to <span className="text-ink">{targetAddress}</span>. It expires
            in 15 minutes.
          </p>
          <CodeInput
            value={code}
            onChange={setCode}
            onComplete={submitCode}
            disabled={confirming}
            autoFocus
          />
          {mode === 'change' ? (
            <p className="text-caption text-ink-subtle">
              Your address only changes once this code is accepted.
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  )
}
