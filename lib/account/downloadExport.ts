// Platform seam for saving the account export (AGENTS.md → Module boundaries:
// lib/ is pure by default, and this is one of the documented exceptions).
//
// The two platforms genuinely cannot share a path. On the web an anchor with
// `download` is the whole story. Inside the Capacitor webview that anchor does
// nothing useful — there is no download manager behind it — so the bytes have
// to be handed to the native filesystem instead, where the Files app can reach
// them.

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

export interface ExportDestination {
  /** Copy for the confirmation toast — where the file actually went. */
  message: string
}

function filenameFor(now: Date): string {
  return `kitto-export-${now.toISOString().slice(0, 10)}.json`
}

export async function saveExport(json: string, now = new Date()): Promise<ExportDestination> {
  const filename = filenameFor(now)

  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    return { message: 'Saved to Files.' }
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    // Safari ignores a click on an anchor that was never in the document.
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    // Revoking synchronously can cancel the download in some browsers; one turn
    // of the event loop is enough for the navigation to have been claimed.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return { message: 'Downloaded.' }
}
