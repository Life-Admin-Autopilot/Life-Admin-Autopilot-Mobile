// Shared shapes for the natural-language eval suites.
//
// Split out of nl-eval.ts so the harness (context scaffold, matcher, runner,
// report) and the case catalogues can grow independently — the single file was
// past 900 lines with the cases inline, and the hard suite adds 50 more.

import type { AiLocale } from '../../src/modules/ai/promptLanguage'

export interface FakeTask {
  id: string
  title: string
  domain: string
  status: 'open' | 'done' | 'snoozed'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  dueAt?: string // ISO
  notes?: string
  tags?: string[]
  subtasks?: Array<{ id: string; text: string; done: boolean }>
}

export interface ExpectedTool {
  name: string
  // Subset of args we care about for this case. Title is checked as a
  // case-insensitive substring; priority/domain/status are exact; arrays
  // require all expected items present (order-independent).
  args?: Record<string, unknown>
}

/** Inclusive bounds on how many times one tool may be called in a turn. */
export interface CountBound {
  min?: number
  max?: number
}

export interface EvalCase {
  category: string
  prompt: string
  tasks?: FakeTask[]
  /**
   * Prior turns, oldest first — the same `contents` shape the API sends. Lets a
   * case test behaviour that only exists ACROSS turns: whether a reply follows
   * the locale rather than the language of an earlier message, or whether a
   * follow-up ("make that one urgent") resolves against what was just filed.
   */
  history?: Array<{ role: 'user' | 'model'; text: string }>
  /**
   * The user's Settings language, which is what decides the language Kitto
   * writes in — NOT the language of the prompt. Defaults to 'en'.
   *
   * Passing this at all matters: the harness used to call getSystemPrompt()
   * with no argument, which rendered the rule as "Write every word the user
   * will read in undefined." Every multi-language case was graded against a
   * malformed prompt.
   */
  locale?: AiLocale
  /** One line on what the case is really testing. Printed when it fails. */
  trap?: string
  expect: {
    // Pass when the union of model tool calls satisfies ALL `tools`. Use
    // an empty array to assert NO tool calls.
    tools?: ExpectedTool[]
    // Tool names that must NOT appear at all. Lets a case assert the model
    // HELD (holdForClarification) and did NOT silently guess (createTask),
    // or that it just created without over-asking.
    forbidTools?: string[]
    /**
     * Bounds on call counts per tool. This is what `tools` cannot say: `tools`
     * is satisfied by AT LEAST the listed calls, so it can never catch a model
     * that fires a second createTask for an item it already held, splits a bulk
     * wipe into N deletes, or re-creates a task it was asked to correct.
     */
    toolCounts?: Record<string, CountBound>
    /**
     * Calls that must NOT exist with these args. The retraction cases need it:
     * "make it urgent — no wait, normal is fine" is only correct if NO
     * createTask carries the abandoned value, and a plain count cannot see that.
     */
    forbidArgs?: ExpectedTool[]
    /**
     * Alternative expectation groups — pass when ANY ONE group is fully
     * satisfied. Some rules genuinely admit two right answers: "urgent with no
     * date" must resolve to EITHER a dated createTask OR a hold, and the prompt
     * deliberately allows both. Asserting one of them would fail a model that
     * chose the other correct branch.
     */
    anyOf?: ExpectedTool[][]
    // Optional substring (case-insensitive) the model's text reply must
    // contain — useful for "decline / clarify" cases.
    textIncludes?: string
    /**
     * Script the reply prose must be written in. 'arabic' requires Arabic
     * letters and no long Latin run; 'latin' the reverse. Checks the LANGUAGE
     * rule end-to-end, which no tool-call assertion can reach.
     */
    replyScript?: 'arabic' | 'latin'
  }
}

export interface CaseOutcome {
  case: EvalCase
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>
  text: string
  pass: boolean
  reasons: string[]
}
