import { Type } from '@google/genai'
import { z } from 'zod'

import { translationLanguageRule, type AiLocale } from '../../ai/promptLanguage'

// The model half of a backlog translation: what it is asked, and the shape it
// must answer in.
//
// Smaller batches than categorize (25 vs 40) because each item here carries a
// title, up to 2000 characters of notes and every subtask, where a categorize
// item is a title and maybe a note preview. The limit that matters is total
// tokens in one call, not item count.
export const MAX_TRANSLATE_BATCH = 25

/**
 * Ceiling on one run, regardless of what the user selected.
 *
 * Sized to what an HTTP request can finish, not to what the model could handle:
 * 150 matters is 6 sequential Gemini calls, roughly 20-30s. The run is
 * synchronous today, so this is the honest bound. Raising it means moving the
 * run to a background worker with progress polling — the lease pattern in
 * lib/documentScanWorker.ts is the template — and that is the change to make
 * before this number moves.
 */
export const MAX_TRANSLATE_TARGETS = 150

export const ModelTranslateSchema = z.object({
  items: z
    .array(
      z.object({
        taskId: z.string(),
        title: z.string().max(240).nullish(),
        notes: z.string().max(2000).nullish(),
        subtasks: z
          .array(z.object({ id: z.string(), text: z.string().max(240) }))
          .nullish(),
      }),
    )
    .catch([]),
})

export const responseSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          taskId: { type: Type.STRING },
          title: { type: Type.STRING },
          notes: { type: Type.STRING, nullable: true },
          subtasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { id: { type: Type.STRING }, text: { type: Type.STRING } },
              required: ['id', 'text'],
              propertyOrdering: ['id', 'text'],
            },
          },
        },
        required: ['taskId', 'title', 'subtasks'],
        propertyOrdering: ['taskId', 'title', 'notes', 'subtasks'],
      },
    },
  },
  required: ['items'],
}

const SYSTEM_BASE = `
You translate a person's saved to-dos ("matters") into another language.

You are given matters, one block per matter, as:
  [id] title
  notes: ...            (only when the matter has notes)
  - <subtaskId> text    (one line per step, only when the matter has steps)

For EVERY id you are given, return one item carrying:
- taskId: the id, copied EXACTLY as given. Never invent one, never return one you
  were not given, never reformat it.
- title: the translated title.
- notes: the translated notes, or null when the matter had none. Never invent notes.
- subtasks: one entry per step you were given, each with the step's id copied
  exactly and its translated text. Empty array when the matter had no steps.

WHAT THIS IS NOT
- Not a summary. A long note comes back long.
- Not an edit. If the title is vague, badly punctuated, or has a typo, translate
  it as it is — the user wrote it and will not expect it to change.
- Not a re-categorisation. You are not judging what the matter is about.

Return ONLY the JSON object. No prose.
`.trim()

export function systemFor(locale: AiLocale): string {
  return [SYSTEM_BASE, translationLanguageRule(locale)].join('\n\n')
}
