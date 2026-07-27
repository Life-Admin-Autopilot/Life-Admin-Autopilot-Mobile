import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { env } from '../env'

export interface DocumentScanStorage {
  put(key: string, bytes: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  remove(key: string): Promise<void>
}

class LocalDiskStorage implements DocumentScanStorage {
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

let cached: DocumentScanStorage | null = null

export function getDocumentScanStorage(): DocumentScanStorage {
  if (cached) return cached
  const root = env().DOCUMENT_SCAN_STORAGE_DIR ?? join(process.cwd(), 'uploads', 'document-scans')
  cached = new LocalDiskStorage(root)
  return cached
}

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
}

export function buildStorageKey(userId: string, scanId: string, mimeType: string): string {
  const ext = EXT_BY_MIME[mimeType] ?? 'bin'
  return `${userId}/${scanId}.${ext}`
}
