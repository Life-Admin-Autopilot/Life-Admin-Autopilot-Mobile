import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Model, Types } from 'mongoose'

import { MANIFEST_FILE } from '../config'

// Bulk insert that keeps the dates it is given, plus the run manifest that
// makes the whole thing undoable.

const BATCH = 500

export interface SeedManifest {
  seededAt: string
  userId: string
  seed: number
  /** Collection name -> the _ids this run created. */
  ids: Record<string, string[]>
  /** Files written outside Mongo (scanned-document PDFs). */
  files: string[]
}

export interface SeedDoc {
  _id: Types.ObjectId
  [key: string]: unknown
}

const manifest: SeedManifest = {
  seededAt: '',
  userId: '',
  seed: 0,
  ids: {},
  files: [],
}

export function beginManifest(userId: string, seed: number, seededAt: Date): void {
  manifest.seededAt = seededAt.toISOString()
  manifest.userId = userId
  manifest.seed = seed
  manifest.ids = {}
  manifest.files = []
}

export function recordFile(path: string): void {
  manifest.files.push(path)
}

export async function saveManifest(): Promise<string> {
  const path = join(process.cwd(), MANIFEST_FILE)
  await writeFile(path, JSON.stringify(manifest, null, 2))
  return path
}

export async function loadManifest(): Promise<SeedManifest | null> {
  try {
    return JSON.parse(await readFile(join(process.cwd(), MANIFEST_FILE), 'utf8')) as SeedManifest
  } catch {
    return null
  }
}

// The one place `timestamps: false` is passed.
//
// Mongoose supports it at runtime (lib/model.js) but leaves it out of
// InsertManyOptions in the .d.ts, so the cast is load-bearing rather than
// laziness — without the option every seeded document is stamped with today
// and the three-year history collapses into a single afternoon.
interface RawInsert {
  insertMany(docs: readonly unknown[], options: unknown): Promise<unknown>
}

export async function insertAll<T>(
  model: Model<T>,
  docs: readonly SeedDoc[],
): Promise<number> {
  if (docs.length === 0) return 0

  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH)
    await (model as unknown as RawInsert).insertMany(chunk, { timestamps: false })
  }

  const key = model.modelName
  const existing = manifest.ids[key] ?? []
  manifest.ids[key] = [...existing, ...docs.map((d) => String(d._id))]
  return docs.length
}
