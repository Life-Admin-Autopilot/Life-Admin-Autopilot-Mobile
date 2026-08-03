'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/Field'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Sheet } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import { toast } from '@/lib/toast'
import { reauthMessages, translateBackendError } from '@/lib/translateBackendError'
import { useChangePassword } from '@/queries/security'

const MIN_LENGTH = 8

export function PasswordSheet({
  open,
  onClose,
  trigger,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
}) {
  const t = useTranslations('profile.password')
  const tCommon = useTranslations('common')
  const tGroups = useTranslations('profile.groups')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const changePassword = useChangePassword()

  // Never leave a typed password sitting in state for the next open.
  useResetOnOpen(open, () => {
    setCurrent('')
    setNext('')
    setConfirm('')
  })

  // Validated here as well as on the server so the user is told before a round
  // trip — but the server is still the authority on both rules.
  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const sameAsOld = next.length > 0 && next === current
  const mismatch = confirm.length > 0 && confirm !== next
  const ready =
    current.length > 0 && next.length >= MIN_LENGTH && confirm === next && !sameAsOld

  const submit = () => {
    if (!ready) return
    changePassword.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success(t('saved'))
          onClose()
        },
        onError: (err) =>
          toast.error(translateBackendError(err, tCommon('notSaved'), reauthMessages())),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={520}
      eyebrow={tGroups('security')}
      title={t('title')}
      footer={
        <Button
          variant="solid"
          className="w-full"
          disabled={!ready || changePassword.isPending}
          onClick={submit}
        >
          {changePassword.isPending ? tCommon('saving') : t('action')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label={t('currentLabel')}>
          <PasswordInput
            autoComplete="current-password"
            placeholder={t('currentPlaceholder')}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>

        <Field
          label={t('newLabel')}
          hint={t('newHint', { min: MIN_LENGTH })}
          error={
            tooShort
              ? t('newHint', { min: MIN_LENGTH })
              : sameAsOld
                ? t('sameAsCurrent')
                : undefined
          }
        >
          <PasswordInput
            autoComplete="new-password"
            placeholder={t('newPlaceholder', { min: MIN_LENGTH })}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={tooShort || sameAsOld || undefined}
          />
        </Field>

        <Field label={t('confirmLabel')} error={mismatch ? t('mismatch') : undefined}>
          <PasswordInput
            autoComplete="new-password"
            placeholder={t('confirmPlaceholder')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch || undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </Field>

        {/* Stated up front, not discovered afterwards on another device. */}
        <p className="text-caption text-ink-subtle">
          This signs out your other devices. This one stays signed in.
        </p>
      </div>
    </Sheet>
  )
}
