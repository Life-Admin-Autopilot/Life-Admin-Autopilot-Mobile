'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { Sheet } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import { toast } from '@/lib/toast'
import { reauthMessages, translateBackendError } from '@/lib/translateBackendError'
import { useDeleteAccount, useExportData } from '@/queries/account'

// Closing the account for good.
//
// Unlike deleting matters — which is recoverable from Trash for 30 days and is
// labelled as such — this genuinely is not, so it is the one surface in the app
// that earns `eyebrowTone="danger"`. Two things follow from that:
//
//   1. The consequences are enumerated, not summarised. "Your account will be
//      deleted" tells you nothing; naming the documents and voice notes tells
//      you what you are about to lose.
//   2. Export is offered right here. Someone leaving is exactly who needs their
//      data, and making them find it on the way out is a dark pattern in
//      reverse — an obstacle disguised as a courtesy.

const CONFIRM_WORD = 'delete'

export function DeleteAccountSheet({
  open,
  onClose,
  trigger,
  hasPassword,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  /** Magic-link-only accounts have no password to confirm with. */
  hasPassword: boolean
}) {
  const router = useRouter()
  const t = useTranslations('profile.delete')
  const tProfile = useTranslations('profile')
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const deleteAccount = useDeleteAccount()
  const exportData = useExportData()

  useResetOnOpen(open, () => {
    setPassword('')
    setTyped('')
  })

  // A password account confirms with its password. A passwordless one has
  // nothing to prove with, so it types the word instead — the point of both is
  // the same: make this impossible to do by accident.
  const ready = hasPassword ? password.length > 0 : typed.trim().toLowerCase() === CONFIRM_WORD

  const runExport = () => {
    exportData.mutate(undefined, {
      onSuccess: (destination) => toast.success(tProfile('exported', { message: destination.message })),
      onError: (err) => toast.error(translateBackendError(err, tProfile('notExported'))),
    })
  }

  const confirm = () => {
    if (!ready) return
    deleteAccount.mutate(
      { password: hasPassword ? password : undefined },
      {
        onSuccess: () => {
          onClose()
          toast.success(t('gone'))
          router.replace('/welcome')
        },
        onError: (err) =>
          toast.error(translateBackendError(err, t('failed'), reauthMessages())),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={540}
      eyebrowTone="danger"
      eyebrow={t('eyebrow')}
      title={t('title')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            Keep my account
          </button>
          <Button
            className="h-8 gap-1 bg-danger px-4 text-caption text-accent-ink hover:bg-danger/90"
            disabled={!ready || deleteAccount.isPending}
            onClick={confirm}
          >
            {deleteAccount.isPending ? t('deleting') : t('action')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink">
          Everything Kitto holds for you goes with it, permanently.
        </p>

        <ul className="flex flex-col gap-1.5 rounded-2xl bg-danger-soft px-4 py-3.5">
          {[
            t('losesMatters'),
            t('losesDocuments'),
            t('losesVoice'),
            t('losesChat'),
          ].map((item) => (
            <li key={item} className="text-body-sm text-danger">
              {item}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={runExport}
          disabled={exportData.isPending}
          className="flex items-center gap-3 rounded-2xl bg-surface-sunken px-4 py-3.5 text-start transition-transform active:scale-[0.99] disabled:opacity-50"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-heading-sm text-ink">
              {exportData.isPending ? t('preparing') : t('takeData')}
            </span>
            <span className="block text-body-sm text-ink-muted">
              Downloads everything above as a file.
            </span>
          </span>
        </button>

        {hasPassword ? (
          <Field label={t('passwordLabel')} hint={t('passwordHint')}>
            <PasswordInput
              autoComplete="current-password"
              placeholder={t('passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        ) : (
          <Field label={t('confirmLabel', { word: CONFIRM_WORD })}>
            <Input
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={CONFIRM_WORD}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}
