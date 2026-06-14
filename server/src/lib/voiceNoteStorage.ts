import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../env'

export interface VoiceNoteStorage {
  put(key: string, bytes: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
}

class LocalDiskStorage implements VoiceNoteStorage {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.resolve(key)
    const dir = path.slice(0, path.lastIndexOf('/'))
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(path, bytes)
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key))
  }

  async remove(key: string): Promise<void> {
    await unlink(this.resolve(key))
  }

  private resolve(key: string): string {
    if (key.includes('..')) throw new Error('storage:invalid-key')
    return join(this.root, key)
  }
}

let cached: VoiceNoteStorage | null = null

export function getVoiceNoteStorage(): VoiceNoteStorage {
  if (cached) return cached
  const root = env().VOICE_NOTE_STORAGE_DIR ?? join(process.cwd(), 'uploads', 'voice-notes')
  cached = new LocalDiskStorage(root)
  return cached
}

export function buildStorageKey(userId: string, noteId: string): string {
  return `${userId}/${noteId}.m4a`
}
