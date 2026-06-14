import { cn } from '@/lib/cn'

// The system's action / brand mark — a plus (create-action). Used as the
// tab-bar center create-action and the wordmark glyph. Crimson by default
// (inherits currentColor).
export function Plus({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn('text-accent', className)}
    >
      <rect x="10.6" y="4" width="2.8" height="16" rx="1.4" />
      <rect x="4" y="10.6" width="16" height="2.8" rx="1.4" />
    </svg>
  )
}
