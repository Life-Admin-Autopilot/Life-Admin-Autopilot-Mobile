import { cn } from '@/lib/cn'

// Where you are in the flow, under the island. Steps already behind you keep a
// faded coral so the trail reads as progress rather than as six identical dots.
export function OnboardingProgress({ total, index }: { total: number; index: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-valuetext={`Step ${index + 1} of ${total}`}
      className="flex gap-1.5"
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 rounded-pill transition-all duration-300',
            i === index ? 'w-5 bg-accent' : i < index ? 'w-1.5 bg-accent/40' : 'w-1.5 bg-border-strong',
          )}
        />
      ))}
    </div>
  )
}
