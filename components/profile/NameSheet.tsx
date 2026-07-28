'use client'

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
          toast.success('Name saved.')
          onClose()
        },
        onError: (err) => toast.error(translateBackendError(err, "That didn't save.")),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={300}
      eyebrow="Account"
      title="Your name"
      footer={
        <Button
          variant="solid"
          className="w-full"
          disabled={!trimmed || unchanged || tooLong || update.isPending}
          onClick={save}
        >
          {update.isPending ? 'Saving…' : 'Save name'}
        </Button>
      }
    >
      <Field
        label="Name"
        hint="What Kitto calls you."
        error={tooLong ? `Keep it under ${MAX_LENGTH} characters.` : undefined}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
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
