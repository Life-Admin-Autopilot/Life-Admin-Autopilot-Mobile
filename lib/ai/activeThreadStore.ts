// Which chat thread the island is showing.
//
// Lives outside React because the panel unmounts every time the island
// collapses back to the FAB (MorphSurface swaps its children), and a thread the
// user deliberately switched to must survive that — component state would snap
// back to the default on every reopen.
//
// Deliberately NOT persisted. `null` means "resume the most recent thread",
// which the thread list already answers (it is sorted by last activity), so
// persisting an id would only add a way for a reopened app to point at a thread
// that has since been deleted on another device.

import { create } from 'zustand'

interface ActiveThreadState {
  /** Null until the user picks one — see the note above on what null means. */
  activeId: string | null
  setActiveId: (id: string | null) => void
}

export const useActiveThreadStore = create<ActiveThreadState>((set) => ({
  activeId: null,
  setActiveId: (activeId) => set({ activeId }),
}))

/** Read the id imperatively (outside a render), e.g. from a stream callback. */
export function activeThreadId(): string | null {
  return useActiveThreadStore.getState().activeId
}
