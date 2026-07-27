import Image from 'next/image'

import { cn } from '@/lib/cn'
import ghostEyeless from '@/assets/ghost/logo-without-eyes.png'

/**
 * The mascot with living eyes.
 *
 * The artwork ships with empty white sockets and the pupils are drawn in CSS,
 * so they can look around without a sprite sheet or a second asset per frame.
 * Two absolutely-positioned discs sit inside the sockets and translate —
 * transform only, which keeps the whole thing on the compositor.
 *
 * Geometry is measured from the source art rather than eyeballed, because
 * eyeballing it is what makes a mascot uncanny:
 *
 *   socket centres        x 37.5% / 61.1%,  y 36.5%   (of the logo box)
 *   socket inner white    ~15% × ~13.8%
 *   pupil                 47% of socket width, 69% of its height
 *
 * That last ratio is the important one. The pupil is a TALL OVAL (aspect
 * 0.75), matching the drawn artwork — a small perfect circle floating in the
 * middle of a big white socket reads as a doll's dead stare, which is exactly
 * what it looked like before this was measured.
 */
const SOCKET = {
  left: '37.5%',
  right: '61.1%',
  top: '36.5%',
} as const

/** Pupil box, as a percentage of the logo box. Taller than wide, on purpose. */
const PUPIL_W = '7.8%'
const PUPIL_H = '10.4%'

/**
 * Resting gaze when the eyes are parked: down, toward the content the mascot
 * is sitting above. Percentage of the pupil's own height.
 */
const REST_Y = 'translateY(14%)'

export function GhostLogo({
  size = 200,
  animate = true,
  label,
  className,
  priority = false,
}: {
  /** Rendered box in px. The art is square. */
  size?: number
  /** Eyes glance around when true; parked looking down when false. */
  animate?: boolean
  /** Accessible name. Omit for decorative use — it renders aria-hidden. */
  label?: string
  className?: string
  priority?: boolean
}) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size }}
      className={cn('relative block shrink-0 select-none', className)}
    >
      <Image
        src={ghostEyeless}
        alt=""
        fill
        priority={priority}
        sizes={`${size}px`}
        className="object-contain"
      />
      <Pupil x={SOCKET.left} animate={animate} />
      <Pupil x={SOCKET.right} animate={animate} />
    </span>
  )
}

function Pupil({ x, animate }: { x: string; animate: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        left: x,
        top: SOCKET.top,
        width: PUPIL_W,
        height: PUPIL_H,
        // The wrapper owns placement (centre on the socket); the inner disc
        // owns the gaze, so the two transforms never fight over one property.
        transform: 'translate(-50%, -50%)',
      }}
      className="pointer-events-none absolute"
    >
      <span
        style={{ transform: REST_Y }}
        className={cn(
          'block h-full w-full rounded-[50%] bg-[#161616]',
          animate && 'motion-safe:animate-ghost-look',
        )}
      />
    </span>
  )
}
