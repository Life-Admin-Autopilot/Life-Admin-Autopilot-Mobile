import { Type } from '@google/genai'
import { z } from 'zod'

import { CONFIDENCE_BUCKETS } from '../../../models/Task'
import { DOMAINS } from '../../../models/User'

// The model half of the categorize pass: what it is asked, and the shape it
// must answer in.
//
// Kept apart from propose.ts because the prompt is the part that gets tuned
// and re-read, and it should be legible without the plumbing around it.

// One round trip's worth. Same reasoning as MAX_BACKLOG_BATCH in
// estimateBacklog: a single enormous prompt degrades every judgment inside it.
export const MAX_CATEGORIZE_BATCH = 40

// The ceiling on one RUN, across batches. MAX_BULK_TARGETS is 500, which is
// the right cap for "delete these" and a badly wrong one here — a proposal is
// only worth making if a person will actually read it, and nobody reviews 500
// rows of before-and-after.
export const MAX_CATEGORIZE_TARGETS = 80

// At most this many tags proposed per matter. The cap is the point: a model
// asked for "tags" with no ceiling returns six, and a matter wearing six tags
// is not categorised, it is decorated.
export const MAX_PROPOSED_TAGS = 3

export const ModelCategorizeSchema = z.object({
  items: z
    .array(
      z.object({
        taskId: z.string(),
        domain: z.string().nullish(),
        confidence: z.string().nullish(),
        reason: z.string().max(400).nullish(),
        // Comma-separated, not an array — see responseSchema below.
        tags: z.string().max(200).nullish(),
      }),
    )
    .catch([]),
})

export const responseSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      // No `maxItems`, deliberately.
      //
      // Gemini 400s the whole request with "the specified schema produces a
      // constraint that has too many states for serving" when a length-bounded
      // array holds an item object this wide (five properties, two of them free
      // strings). estimateBacklog gets away with maxItems because its item has
      // three narrow properties — it is the combination that tips over, not the
      // bound alone. Verified by bisecting the schema against the live API:
      // removing maxItems is what fixes it; removing the enums also "fixes" it
      // but the model then answers `domain: "Automotive"`, so the enums stay.
      //
      // Nothing is lost. The batch is bounded by what we SEND, and every id in
      // the reply is checked against that set, so a longer answer is discarded
      // rather than trusted.
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          taskId: { type: Type.STRING },
          domain: { type: Type.STRING, enum: [...DOMAINS] },
          confidence: { type: Type.STRING, enum: [...CONFIDENCE_BUCKETS] },
          reason: { type: Type.STRING },
          // A STRING holding a comma-separated list, not an ARRAY — one less
          // nested structure in a schema that already sits near the limit of
          // what the structured-output decoder will serve (see the note on
          // `items` above). Splitting on commas costs one line, and the count
          // is capped in code regardless, since a model is not to be trusted
          // with its own limit either way.
          tags: { type: Type.STRING },
        },
        required: ['taskId', 'domain', 'confidence', 'reason', 'tags'],
        propertyOrdering: ['taskId', 'domain', 'confidence', 'reason', 'tags'],
      },
    },
  },
  required: ['items'],
}

// What each domain actually means, in the user's terms. Without this the model
// splits on the noun in the title rather than on whose problem it is — "pay the
// vet bill" is pets, not finance, because it is a thing about the cat.
const DOMAIN_GUIDE = `
  health   — the person's own body: appointments, prescriptions, tests, cover.
  home     — the dwelling: repairs, utilities as SERVICE, cleaning, contents.
  car      — the vehicle: servicing, licence, fines, insurance, parts.
  finance  — money as the subject: bills, statements, tax, refunds, subscriptions.
  family   — other people: school, gifts, visits, their documents and admin.
  pets     — the animal: food, vet, grooming, boarding.
`.trim()

export const SYSTEM = `
You file a person's to-dos into the right area of life, and suggest a few tags.

You are given matters, one per line, as:
  [id] title
  notes: ...        (only when the matter has notes)
  tags: a, b        (only when the matter already has tags)

For EVERY id you are given, return one item.

--- domain ---
Choose exactly one of: ${DOMAINS.join(', ')}.

${DOMAIN_GUIDE}

File by WHOSE PROBLEM IT IS, not by the most prominent noun. "Pay the vet bill"
is pets. "Pay the school fees" is family. "Pay the electricity bill" is finance
when it is about settling money, home when it is about the supply itself — prefer
finance for anything whose verb is paying.

You are NOT told what area the matter is currently filed under. That is
deliberate. Judge it fresh from the words.

--- confidence ---
high    — the title says plainly what this is.
medium  — the reading is likely but the title is thin.
low     — you are guessing.

Be honest here. A "high" you did not mean gets applied without anyone checking
it, so an unearned high is worse than an accurate low.

--- reason ---
At most twelve words, describing why THIS matter belongs in THAT area. Write it
for the person whose list it is. No preamble, no restating the title.

--- tags ---
Up to ${MAX_PROPOSED_TAGS} short lowercase tags as ONE COMMA-SEPARATED STRING,
for example: insurance, renewal. Single words or hyphenated. Empty string when
there is nothing to add.

PREFER the vocabulary the person already uses — it is given to you below. Reuse
an existing tag whenever it fits rather than minting a synonym: someone who
already has "insurance" does not need "car-insurance-renewal".

Do not repeat the domain as a tag. Do not tag something that is true of every
matter. Return an empty list when nothing useful applies — no tags is a normal
and correct answer.

Never invent an id. Never return an id you were not given.

Return ONLY the JSON object. No prose.
`.trim()
