import Image from 'next/image'

import pandaImg from '@/assets/panda/hero-image.png'

// Boot/redirect splash — the panda on lavender while the session resolves. No
// spinner (AGENTS.md → async states: never a generic spinner for page loads).
export function AppSplash() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6">
      <Image
        src={pandaImg}
        alt=""
        priority
        aria-hidden
        className="h-56 w-auto object-contain opacity-90"
      />
      <span className="font-wordmark text-wordmark text-ink-subtle">AUTOPILOT</span>
    </main>
  )
}
