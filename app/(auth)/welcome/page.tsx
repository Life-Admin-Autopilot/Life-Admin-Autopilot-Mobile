'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import ghostImg from '@/assets/ghost/logo.png'
import { Button } from '@/components/ui/button'
import { env } from '@/lib/env'

// The front door. A coral wash across the top fading into the canvas, the
// mascot, the creed in serif, two ways in. This is one of the four surfaces
// allowed gradient — the others are onboarding, celebration, and AI preview.
//
// A CLIENT component, and it has to be one. next-intl's `getTranslations` wants
// a request-scoped locale and there is no request here: Kitto is a static
// export with no server, and the language is a client setting held in
// lib/i18n/localeStore. LocaleProvider is the only thing that knows it, so the
// first screen anyone ever sees has to read from inside the tree. Nothing here
// touches a browser API, so the page still prerenders to the same HTML.
export default function WelcomePage() {
  const t = useTranslations('auth.welcome')

  return (
    <main className="bg-hero-gradient flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <span className="font-wordmark text-wordmark text-ink">{env.appName}</span>

        <Image src={ghostImg} alt={t('mascotAlt')} priority className="h-56 w-auto object-contain" />

        {/* Two keys, not one message carrying a <br/>: the break is the creed's
            typography, and a translator should be able to rework the wording
            without hauling our markup along with it. */}
        <h1 className="font-display text-display-hero text-balance text-ink">
          {t('speakOnce')}
          <br />
          {t('orderFollows')}
        </h1>

        <div className="pb-safe mt-3 flex w-full flex-col gap-3">
          <Button render={<Link href="/sign-up" />} variant="solid" size="lg" className="w-full">
            {t('begin')}
          </Button>
          <Button render={<Link href="/sign-in" />} variant="ghost" size="lg" className="w-full">
            {t('haveAccount')}
          </Button>
        </div>
      </div>
    </main>
  )
}
