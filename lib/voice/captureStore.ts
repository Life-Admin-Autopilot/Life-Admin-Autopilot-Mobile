// Tiny global toggle for the voice-capture island. The TabBar's center button
// lives in a different subtree from the VoiceIsland overlay, so a store decouples
// "open the mic" (anywhere) from the surface that renders it.

import { create } from 'zustand'

interface VoiceCaptureState {
  open: boolean
  openCapture: () => void
  close: () => void
}

export const useVoiceCapture = create<VoiceCaptureState>((set) => ({
  open: false,
  openCapture: () => set({ open: true }),
  close: () => set({ open: false }),
}))
