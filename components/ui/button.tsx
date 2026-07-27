import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Everything is a pill. Two fills carry meaning and must not be swapped:
//   `solid`  — near-black (near-white in dark). THE primary CTA.
//   `accent` — coral. Active / selected / confirm / FAB. Never the default CTA.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-pill border border-transparent bg-clip-padding font-sans font-bold whitespace-nowrap transition-all outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        solid: "bg-solid text-solid-ink hover:opacity-90",
        default: "bg-solid text-solid-ink hover:opacity-90",
        accent: "bg-accent text-accent-ink hover:bg-accent-pressed",
        secondary:
          "bg-surface-field text-ink hover:brightness-[0.97] aria-expanded:brightness-[0.97]",
        outline:
          "border-border-strong bg-surface text-ink hover:bg-canvas-veined aria-expanded:bg-canvas-veined",
        ghost:
          "text-ink hover:bg-surface-sunken aria-expanded:bg-surface-sunken",
        destructive: "bg-danger-soft text-danger hover:brightness-[0.97]",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-5 text-[16px]",
        lg: "h-14 px-6 text-[17px]",
        sm: "h-9 px-3.5 text-[14px] [&_svg:not([class*='size-'])]:size-4",
        xs: "h-7 px-2.5 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        pill: "h-10 px-4 text-[14px] [&_svg:not([class*='size-'])]:size-4",
        icon: "size-11 rounded-full px-0",
        "icon-sm": "size-9 rounded-full px-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-7 rounded-full px-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-12 rounded-full px-0",
        /** Raised circular action — the voice/scan affordance. */
        fab: "size-14 rounded-full px-0 shadow-halo",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      // A custom `render` (e.g. a Next.js <Link>) is not a native <button>,
      // so default `nativeButton` off unless the caller says otherwise.
      nativeButton={nativeButton ?? render === undefined}
      render={render}
      {...props}
    />
  )
}

export { Button, buttonVariants }
