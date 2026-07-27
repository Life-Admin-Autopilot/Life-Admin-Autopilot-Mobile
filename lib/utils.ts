import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * Steward's type scale, shadows and radii are named tokens, not t-shirt sizes.
 * Stock tailwind-merge has no way to know that, so it files `text-display-md`
 * under text-COLOUR and happily deletes it when the same `cn()` call also
 * passes `text-accent` — the size silently vanishes and the element renders at
 * 16px. Declaring the custom groups here is what makes `cn('text-display-md',
 * 'text-accent')` keep both.
 *
 * Any token added to the `--text-*` / `--shadow-*` / `--radius-*` sets in
 * app/globals.css must be added here too.
 */
const TEXT_SIZES = [
  "wordmark",
  "display-hero",
  "display-md",
  "heading-serif",
  "countdown",
  "heading-xl",
  "heading-md",
  "heading-sm",
  "body",
  "body-sm",
  "label",
  "caption",
  "tab",
  "micro",
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...TEXT_SIZES] }],
      shadow: [{ shadow: ["card", "elevated", "halo"] }],
      rounded: [{ rounded: ["pill", "tile"] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
