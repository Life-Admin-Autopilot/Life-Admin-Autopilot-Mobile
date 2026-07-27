import { cn } from '@/lib/cn'

// The signature identity mark: an emoji floating in a soft pastel circle.
// This is how a task, matter or domain says "which part of your life am I"
// before you have read a single word of its title.
//
// The pastel set is theme-invariant by design (see globals.css) — a colored
// circle is the one place in the app where hue carries meaning, and dimming it
// in dark mode would throw that away.
export type CatColor =
  | 'lilac'
  | 'periwinkle'
  | 'sky'
  | 'sage'
  | 'yellow'
  | 'peach'
  | 'blush'
  | 'pink'

const CAT_BG: Record<CatColor, string> = {
  lilac: 'bg-cat-lilac',
  periwinkle: 'bg-cat-periwinkle',
  sky: 'bg-cat-sky',
  sage: 'bg-cat-sage',
  yellow: 'bg-cat-yellow',
  peach: 'bg-cat-peach',
  blush: 'bg-cat-blush',
  pink: 'bg-cat-pink',
}

export function EmojiChip({
  emoji,
  category = 'lilac',
  size = 44,
  tilt = false,
  square = false,
  className,
  label,
}: {
  emoji: string
  category?: CatColor
  size?: number
  /** Playful sticker lean. Celebration surfaces only — never in a list. */
  tilt?: boolean
  /** Rounded square instead of a circle: document types, calendar imports. */
  square?: boolean
  className?: string
  /** Accessible name. Omit when an adjacent title already names the thing. */
  label?: string
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center',
        square ? 'rounded-tile' : 'rounded-full',
        CAT_BG[category],
        tilt && '-rotate-[8deg]',
        className,
      )}
    >
      <span className="leading-none">{emoji}</span>
    </span>
  )
}
