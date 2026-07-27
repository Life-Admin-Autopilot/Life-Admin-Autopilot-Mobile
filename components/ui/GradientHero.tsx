import { cn } from '@/lib/cn'

// The emotional surfaces — welcome, onboarding, "you closed the day". Gradient
// is rationed to exactly these moments; cards, rows and chips stay flat, which
// is what makes a gradient mean something when it does appear.
export function GradientHero({
  variant = 'hero',
  glyph,
  title,
  subtitle,
  children,
  className,
}: {
  /** `hero` washes coral→canvas downward; `celebrate` runs the other way. */
  variant?: 'hero' | 'celebrate'
  glyph?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'flex flex-col items-center px-6 text-center',
        variant === 'hero' ? 'bg-hero-gradient' : 'bg-celebrate-gradient',
        className,
      )}
    >
      {glyph ? <div className="mb-5">{glyph}</div> : null}
      <h1 className="font-display text-display-hero text-ink text-balance">{title}</h1>
      {subtitle ? <p className="mt-2 max-w-[30ch] text-body text-ink-muted">{subtitle}</p> : null}
      {children ? <div className="mt-7 w-full">{children}</div> : null}
    </section>
  )
}
