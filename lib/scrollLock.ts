'use client'

// Ref-counted body scroll lock.
//
// A plain `overflow = 'hidden'` + restore-on-unmount effect breaks the moment
// two overlays overlap, which they now do by design: an interrupted morph keeps
// the outgoing surface mounted while the incoming one is already growing. React
// mounts the new one BEFORE the old one unmounts, so the old cleanup captured
// `original = 'hidden'`... and then restores '' — unlocking the page underneath
// a surface that is still open. Counting lockers instead means the page only
// unlocks when the last one is gone.

import { useEffect } from 'react'

let locks = 0
let original = ''

export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return
    if (locks === 0) {
      original = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    locks += 1
    return () => {
      locks -= 1
      if (locks === 0) document.body.style.overflow = original
    }
  }, [active])
}
