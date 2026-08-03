'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/Field'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { useUpdateProfile } from '@/queries/profile'

const MAX_LENGTH = 80

// Draft state lives here, not in the caller (AGENTS.md → Sheets): an abandoned
// edit must not leak back into the page behind it.

export function NameSheet({
  open,
  onClose,
  trigger,
  currentName,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  currentName?: string
}) {
  const t = useTranslations('profile.name')
  const tCommon = useTranslations('common')
  const tGroups = useTranslations('profile.groups')
  const [name, setName] = useState(currentName ?? '')
  const update = useUpdateProfile()

  // Reopening after a cancel starts from the saved value, not the abandoned one.
  useResetOnOpen(open, () => setName(currentName ?? ''))

  const trimmed = name.trim()
  const unchanged = trimmed === (currentName ?? '').trim()
  const tooLong = trimmed.length > MAX_LENGTH

  const save = () => {
    if (!trimmed || unchanged || tooLong) return
    update.mutate(
      { displayName: trimmed },
      {
        onSuccess: () => {
          toast.success(t('saved'))
          onClose()
        },
        onError: (err) => toast.error(translateBackendError(err, tCommon('notSaved'))),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={300}
      eyebrow={tGroups('account')}
      title={t('title')}
      footer={
        <Button
          variant="solid"
          className="w-full"
          disabled={!trimmed || unchanged || tooLong || update.isPending}
          onClick={save}
        >
          {update.isPending ? tCommon('saving') : t('save')}
        </Button>
      }
    >
      <Field
        label={t('label')}
        hint={t('hint')}
        error={tooLong ? t('tooLong', { max: MAX_LENGTH }) : undefined}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('placeholder')}
          autoComplete="name"
          aria-invalid={tooLong || undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
          }}
        />
      </Field>
    </Sheet>
  )
}
