// "Open this matter" — a request any surface can make, from anywhere.
//
// A store rather than a URL, and the reason is a bug the URL could not fix.
// /matters reads `?open={taskId}` in a useState INITIALISER, which is exactly
// right for arriving cold from a notification: it runs once, on mount, and the
// user is free to navigate away from it afterwards. But an initialiser only runs
// on mount — so a request made while /matters was ALREADY the current screen
// pushed a new URL, re-rendered nothing, and silently did nothing at all. The
// clash pop-up hit this every time: from the dashboard it worked, from the
// matters list it looked broken.
//
// So the deep link stays for cold starts and this carries the in-app case. The
// page derives its open matter from `local ?? requested` at RENDER time, which
// keeps it out of an effect — the request is already state, and turning state
// into other state in an effect is the loop this codebase avoids.
//
// A seam, not a pure module (AGENTS.md → Module boundaries): it is one of the
// `lib/*Store.ts` client stores, alongside tabBarStore and voice/captureStore.

import { create } from 'zustand'

interface OpenMatterState {
  /** The matter a surface has asked for, or null when nothing is pending. */
  taskId: string | null
  request: (taskId: string) => void
  clear: () => void
}

const useOpenMatterStore = create<OpenMatterState>((set) => ({
  taskId: null,
  request: (taskId) => set({ taskId }),
  clear: () => set({ taskId: null }),
}))

/** The pending request, for the screen that fulfils it. */
export const useRequestedMatter = () => useOpenMatterStore((s) => s.taskId)

/** Clears it once opened, so returning to the list later does not reopen it. */
export const useClearRequestedMatter = () => useOpenMatterStore((s) => s.clear)

/**
 * Ask for a matter to be opened.
 *
 * Callable outside React — from a toast callback, a notification handler — which
 * is the whole point: the caller is usually not a component that could hold a
 * hook. Navigate to /matters/ after calling this; if that screen is already up,
 * it reacts on its own.
 */
export function requestOpenMatter(taskId: string): void {
  useOpenMatterStore.getState().request(taskId)
}
