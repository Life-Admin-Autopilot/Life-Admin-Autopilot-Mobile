import Image from 'next/image'
import Link from 'next/link'

import ghostImg from '@/assets/ghost/logo.png'
import { Button } from '@/components/ui/button'
import { env } from '@/lib/env'

// The front door. A coral wash across the top fading into the canvas, the
// mascot, the creed in serif, two ways in. This is one of the four surfaces
// allowed gradient — the others are onboarding, celebration, and AI preview.
export default function WelcomePage() {
  return (
    <main className="bg-hero-gradient flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <span className="font-wordmark text-wordmark text-ink">{env.appName}</span>

        <Image
          src={ghostImg}
          alt="Our companion, ready to help"
          priority
          className="h-56 w-auto object-contain"
        />

        <h1 className="font-display text-display-hero text-balance text-ink">
          Speak once.
          <br />
          Order follows.
        </h1>

        <div className="pb-safe mt-3 flex w-full flex-col gap-3">
          <Button render={<Link href="/sign-up" />} variant="solid" size="lg" className="w-full">
            Begin
          </Button>
          <Button render={<Link href="/sign-in" />} variant="ghost" size="lg" className="w-full">
            I already have an account
          </Button>
        </div>
      </div>
    </main>
  )
}
