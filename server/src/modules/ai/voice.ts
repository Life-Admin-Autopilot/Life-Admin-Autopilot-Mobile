import type { Content } from '@google/genai'

// Mo's voice — system prompt + few-shot prefill turns. The prefill rides in
// `contents` as past turn pairs (NOT in systemInstruction). Wiscord lesson:
// small models read system-prompt examples as canned Q→A lookup tables and
// copy verbatim. Past turns get read as "this is how I tend to talk" —
// style precedent, not a hit table.
//
// The prompt text used to live inline here (766 lines). It's been split into
// cohesive pieces under voice/ — toolRules.ts (tool/language/voice rules),
// systemPrompt.ts (persona preamble + rules), prefill.ts (few-shot turns).
// This module re-exports the same public API (getSystemPrompt /
// getPrefillContents) so callers (contextBuilder.ts) are unchanged. Behavior
// is byte-for-byte identical to the pre-split version.

import { SYSTEM_PROMPT } from './voice/systemPrompt'
import { PREFILL } from './voice/prefill'

export { SYSTEM_PROMPT } from './voice/systemPrompt'
export { TOOL_RULES } from './voice/toolRules'
export { PREFILL } from './voice/prefill'

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT
}

export function getPrefillContents(): Content[] {
  return PREFILL
}
