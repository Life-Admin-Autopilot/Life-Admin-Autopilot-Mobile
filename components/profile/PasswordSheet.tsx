'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/Field'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Sheet } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import { toast } from '@/lib/toast'
import { REAUTH_MESSAGES, translateBackendError } from '@/lib/translateBackendError'
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
          toast.success('Password changed.')
          onClose()
        },
        onError: (err) =>
          toast.error(translateBackendError(err, "That didn't save.", REAUTH_MESSAGES)),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={520}
      eyebrow="Security"
      title="Change password"
      footer={
        <Button
          variant="solid"
          className="w-full"
          disabled={!ready || changePassword.isPending}
          onClick={submit}
        >
          {changePassword.isPending ? 'Saving…' : 'Change password'}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Current password">
          <PasswordInput
            autoComplete="current-password"
            placeholder="Your current password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>

        <Field
          label="New password"
          hint={`At least ${MIN_LENGTH} characters.`}
          error={
            tooShort
              ? `At least ${MIN_LENGTH} characters.`
              : sameAsOld
                ? 'Pick something different from your current password.'
                : undefined
          }
        >
          <PasswordInput
            autoComplete="new-password"
            placeholder={`At least ${MIN_LENGTH} characters`}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            aria-invalid={tooShort || sameAsOld || undefined}
          />
        </Field>

        <Field
          label="Confirm new password"
          error={mismatch ? "Those don't match." : undefined}
        >
          <PasswordInput
            autoComplete="new-password"
            placeholder="Type it again"
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
