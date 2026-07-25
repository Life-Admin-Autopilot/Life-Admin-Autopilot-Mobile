import Image from 'next/image'
import Link from 'next/link'

import pandaImg from '@/assets/panda/hero-image.png'
import { Button } from '@/components/ui/button'

// The front door. The panda, the wordmark, the creed, two ways in.
export default function WelcomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <div className="flex flex-col items-center gap-1">
        <span className="text-label uppercase text-ink-subtle">Life Admin</span>
        <span className="font-wordmark text-wordmark text-ink">Autopilot</span>
      </div>

      <Image
        src={pandaImg}
        alt="Our panda companion, ready to help"
        priority
        className="h-72 w-auto object-contain"
      />

      <p className="font-display text-display-md text-ink">
        Speak once.
        <br />
        Order follows.
      </p>

      <div className="mt-2 flex w-full flex-col gap-3">
        <Button render={<Link href="/sign-up" />} className="h-12 w-full">
          Begin
        </Button>
        <Button render={<Link href="/sign-in" />} variant="ghost" className="h-12 w-full">
          I already have an account
        </Button>
      </div>
    </main>
  )
}
