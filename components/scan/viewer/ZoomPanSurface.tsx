'use client'

// The gesture viewport. Owns the clipping box and the transformed layer;
// everything about WHAT is being viewed lives in `children`, so a photo and a
// PDF page column get identical pinch, pan and double-tap behaviour from one
// implementation.

import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'
import type { Size } from '@/lib/viewer/zoomPanMath'

interface ZoomPanSurfaceProps {
  containerRef: (node: HTMLDivElement | null) => void
  contentRef: (node: HTMLDivElement | null) => void
  /** Natural content size; the transformed layer is fixed to it. */
  content: Size | null
  className?: string
  children: ReactNode
}

export function ZoomPanSurface({ containerRef, contentRef, content, className, children }: ZoomPanSurfaceProps) {
  return (
    <div
      ref={containerRef}
      className={cn('relative overflow-hidden overscroll-contain', className)}
      // Hands every touch to the pointer handlers. Without it WebKit claims the
      // gesture for panning first and the pinch never arrives intact.
      style={{ touchAction: 'none' }}
    >
      <div
        ref={contentRef}
        style={{
          width: content?.width,
          height: content?.height,
          // Corner origin — the transform math in lib/viewer/zoomPanMath.ts
          // assumes it, and a centred origin puts a half-size term in every
          // anchoring calculation for no benefit.
          transformOrigin: '0 0',
        }}
        // `invisible` is the resting state, deliberately as a CLASS: useZoomPan
        // reveals the layer by writing an inline `visibility` in the same pass
        // that positions it, and an inline value outranks a class. Putting the
        // initial value inline instead would put React in charge of a property
        // the hook needs to own.
        //
        // left-0, NOT start-0: the transform math is physical, so in RTL a
        // logical inset would anchor the layer to the right edge and every
        // translate would be measured from the wrong corner. rtl-allow-physical
        className="invisible absolute left-0 top-0 will-change-transform"
      >
        {children}
      </div>
    </div>
  )
}
