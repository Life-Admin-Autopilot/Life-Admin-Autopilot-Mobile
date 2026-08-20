// What this deployment can actually do for you right now.
//
// The endpoint has existed since the kill switches shipped and NOTHING called it.
// Its own doc comment states the reason it exists — "enforcement alone means the
// app looks completely normal until the user records a voice note and gets an
// error; they blame their microphone, then the app, then retry" — which is
// precisely what has been happening, because the client never asked.
//
// `true` means available. The server does the inversion from its disable-flag
// rows, so nothing here has to reason about a double negative.

import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

export interface Capabilities {
  aiChat: boolean
  documentScan: boolean
  /**
   * Speech-to-text. False for either of two reasons the client deliberately
   * cannot tell apart: an operator has paused it, or the provider itself is
   * refusing every call — which is what an exhausted ASR quota looks like from
   * the server. Both mean the same thing to a person holding a microphone.
   */
  transcription: boolean
}

/**
 * Optimistic while it loads.
 *
 * A surface that hides the microphone for the first second of every app open is
 * worse than one that occasionally offers a mic that turns out to be paused —
 * the first is a bug the user sees every single time.
 */
export const ASSUMED_CAPABILITIES: Capabilities = {
  aiChat: true,
  documentScan: true,
  transcription: true,
}

export function useCapabilities() {
  return useQuery({
    queryKey: queryKeys.capabilities(),
    queryFn: () => api<Capabilities>('/me/capabilities'),
    // A kill switch is flipped by a human and an exhausted quota is topped up by
    // one, so neither changes minute to minute. Five minutes keeps this off the
    // critical path of every navigation while still picking up a change inside
    // one coffee break.
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * The one question the voice surfaces ask. Defaults to available while the
 * query is in flight or has failed — a capabilities call that cannot complete
 * must not be the thing that takes voice away.
 */
export function useTranscriptionAvailable(): boolean {
  const { data } = useCapabilities()
  return data?.transcription ?? ASSUMED_CAPABILITIES.transcription
}
