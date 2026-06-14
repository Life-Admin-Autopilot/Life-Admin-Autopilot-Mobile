'use client'

import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

// Fires a morph-in toast through lib/toast.ts (the single toast source).
export function MorphToastDemo() {
  return (
    <Button
      variant="secondary"
      onClick={() => toast.morph('Task created.', { description: 'Policy attached.' })}
    >
      Fire toast
    </Button>
  )
}
