'use client'

import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion'
import { usePathname } from 'next/navigation'
// Next internal — see the FrozenRouter comment below for why this import exists.
// The `.shared-runtime` module is the one Next itself imports from both the
// server and client bundles, so it is the safe entry point for this context.
import { LayoutRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { useContext, useState, type ContextType, type ReactNode } from 'react'

import { PAGE_BLUR_VARIANTS, PAGE_VARIANTS } from '@/lib/motion'

/**
 * The value carried by Next's `LayoutRouterContext`: the parent segment tree,
 * the cache node the router should render from, and the URL that produced them.
 * Named locally because Next exports the context but not its value type — this
 * alias is `ContextType<>` of the real thing, not a hand-written duplicate, so
 * it cannot drift from the framework, and it keeps the ref below off `any`.
 */
type LayoutRouterValue = ContextType<typeof LayoutRouterContext>

/**
 * FrozenRouter — the reason exit animations are possible at all here.
 *
 * The App Router does not keep the outgoing route around. The moment a
 * navigation commits, `LayoutRouterContext` publishes a NEW `parentTree` /
 * `parentCacheNode`, every `OuterLayoutRouter` beneath it re-reads that context,
 * and the old page's DOM is replaced in the same commit. An `AnimatePresence`
 * would be handed a child that has already swapped its contents — there is
 * nothing left to animate out.
 *
 * (`app/template.tsx` cannot fix this either, and that is not a tuning problem:
 * a template is itself re-created on every navigation, so any `AnimatePresence`
 * living inside one remounts with it and can never observe an exiting child.
 * The host has to persist across navigation, which is why this component is
 * mounted from `app/providers.tsx`.)
 *
 * So we capture the context value on the first render of each keyed child and
 * re-provide that frozen copy to its subtree forever. The child leaving the tree
 * keeps its own instance of this component, keeps being served the pre-navigation
 * tree, and therefore keeps rendering the page you were just looking at while it
 * fades out. The incoming child mounts fresh, captures the post-navigation value,
 * and renders the new page. Nothing is cloned or reconstructed — both subtrees
 * are real routers, each pinned to a different moment.
 *
 * `useState` is used purely as a mount-time capture — the setter is intentionally
 * discarded, so the value is read once on the first render and never changes for
 * the life of this instance. A ref would express the same thing, but reading
 * `ref.current` during render is exactly what the React Compiler lint rule
 * forbids, and here the captured value IS render input.
 *
 * The null branch is the "no router above us" case — impossible inside the App
 * Router, but if it ever happens we pass the real context straight through rather
 * than provide `null` and trip the router's own mounted-invariant.
 */
function FrozenRouter({ children }: { children: ReactNode }) {
  const context = useContext(LayoutRouterContext)
  const [frozen] = useState<LayoutRouterValue>(context)

  if (frozen === null) return <>{children}</>

  return <LayoutRouterContext.Provider value={frozen}>{children}</LayoutRouterContext.Provider>
}

/**
 * Reduced-motion fallback. Not an instant cut: Apple's own reduced-motion
 * substitute for the app-open transition is a cross-fade, and cutting a route in
 * with no transition at all reads as a glitch rather than as calm. Opacity only —
 * no scale, no lift, nothing a vestibular-sensitive person opted out of — and
 * deliberately shorter than the full transition (0.09 out + 0.12 in ≈ 210ms) so
 * nobody is made to wait for an effect they asked not to see.
 *
 * Lives here rather than in `lib/motion.ts` because it is the accessibility
 * fallback for this one component, not part of the shared motion vocabulary.
 */
const REDUCED_PAGE_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.12, ease: 'linear' } },
  exit: { opacity: 0, transition: { duration: 0.09, ease: 'linear' } },
}

/**
 * Route transition host. Wraps ONLY the routed `children` — the tab bar, the
 * islands and the toaster are siblings in `app/providers.tsx` on purpose, so
 * they neither animate nor remount when the page underneath them changes.
 *
 * `mode="wait"` is what produces the iOS sequence: the outgoing page finishes
 * its close before the incoming page begins its open, rather than the two
 * cross-dissolving through each other. It costs the new route ~130ms of mount
 * delay, which is the intended shape of the effect.
 *
 * `initial={false}` suppresses the enter animation for the first child only.
 * Without it the entire app would animate in on hydration — very visible in a
 * static-export SPA, where the shell paints first and JS boots a moment later.
 *
 * Keyed on `usePathname()`, not on a route object: pathname is what the user
 * perceives as "a different screen". The app has no search-param-driven views
 * (nothing calls `useSearchParams`), so this key never misses a navigation, and
 * a hypothetical query-only change correctly does NOT trigger a full transition.
 *
 * The page itself moves only `opacity` and `transform`; the blur rides a
 * separate overlay (below). Nothing here touches a layout property, and that is
 * a hard constraint rather than a preference: `requestAnimationFrame` is pinned
 * to 60Hz inside WKWebView (docs/CAPACITOR.md) and Framer springs run on rAF, so
 * anything that forces layout would drop frames on device with no way to recover.
 *
 * `backdrop-filter` is compositor-driven, but it is not free the way opacity is —
 * it re-samples what it covers. It is kept to a single full-bleed layer that is
 * only non-transparent during the 130ms exit, and is `opacity: 0` at rest.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const reduced = useReducedMotion()

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        variants={reduced ? REDUCED_PAGE_VARIANTS : PAGE_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        className="relative"
      >
        <FrozenRouter>{children}</FrozenRouter>
        {/*
          The blur layer. Deliberately a sibling ABOVE the content rather than a
          `filter` on the wrapper — see PAGE_BLUR_VARIANTS for why that
          distinction is load-bearing (a filtered wrapper becomes a containing
          block for the fixed scrims inside routes, and framer will not let the
          value settle at `none`).

          Empty, `aria-hidden`, and pointer-events-none: it exists only to carry
          a backdrop-filter, must never intercept a tap, and must never be
          announced. Reduced motion drops it entirely — a blur sweep is exactly
          the kind of effect someone opts out of.
        */}
        {!reduced && (
          <motion.div
            aria-hidden
            variants={PAGE_BLUR_VARIANTS}
            className="pointer-events-none absolute inset-0 z-50"
          />
        )}
      </motion.div>
    </AnimatePresence>
  )
}
