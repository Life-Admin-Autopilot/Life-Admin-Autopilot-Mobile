'use client'

import Image from 'next/image'
import { ArrowRight, BadgeCheck } from 'lucide-react'

import { Pill } from '@/components/ui/Pill'
import ghostPose from '@/assets/ghost/logo-pose-2.png'
import type { AuthUser } from '@/lib/auth/sessionStore'

// Who you are, at the top of the page.
//
// The mark is the mascot, not a generated monogram. A letter in a coloured
// circle is what an app shows when it does not know you; Kitto does, and the
// ghost is the thing the user already associates with it from the splash and
// the chat avatar.
//
// The email deliberately is NOT repeated here. It sits one section below in the
// Account row, where it is editable — printing it twice made the hero read like
// a database record, and a raw address is not a headline.
//
// The unverified state gets a prompt card rather than a red badge. An account
// that works fine but has not confirmed its address is not in an error state —
// it has one thing left to do, and the card is the affordance for doing it.

export function ProfileIdentity({
  user,
  onConfirmEmail,
}: {
  user: AuthUser
  /** Opens the email sheet on its code step. Receives the trigger's rect. */
  onConfirmEmail: (rect: DOMRect) => void
}) {
  const verified = Boolean(user.emailVerifiedAt)
  const pro = user.subscription?.tier === 'pro'

  return (
    <section className="flex flex-col items-center gap-2 text-center">
      <Image
        src={ghostPose}
        alt=""
        width={112}
        height={112}
        priority
        className="size-28 select-none object-contain"
      />

      {user.displayName ? (
        <h1 className="font-display text-display-md text-balance text-ink">{user.displayName}</h1>
      ) : (
        // No name yet is a normal state, not a blank — say so plainly rather
        // than rendering an empty heading.
        <h1 className="font-display text-display-md text-ink-muted">No name yet</h1>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {verified ? (
          <Pill tone="success" icon={<BadgeCheck size={14} />}>
            Verified
          </Pill>
        ) : null}
        <Pill tone={pro ? 'accent' : 'field'}>{pro ? 'Pro' : 'Free plan'}</Pill>
      </div>

      {!verified ? (
        <button
          type="button"
          onClick={(e) => onConfirmEmail(e.currentTarget.getBoundingClientRect())}
          className="mt-1 flex w-full items-center gap-3.5 rounded-2xl bg-accent-soft px-4 py-3.5 text-left transition-transform active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1 text-body text-ink">
            Confirm your email so we can reach you about your matters.
          </span>
          <ArrowRight size={17} className="shrink-0 text-accent" />
        </button>
      ) : null}

      {user.pendingEmail ? (
        <p className="text-body-sm text-ink-muted">
          Waiting on confirmation for <span className="text-ink">{user.pendingEmail}</span>.
        </p>
      ) : null}
    </section>
  )
}
