import { PDFDocument } from 'pdf-lib'
import { BadRequest } from './errors'

// Gemini natively understands multi-page PDFs sent as a single inlineData
// part (mimeType application/pdf) — no page rasterization needed, unlike the
// original design here. pdf-lib is used ONLY to read the page count cheaply
// (no rendering) so an oversized PDF is rejected before storage + the worker,
// not mid-processing.
export async function countPdfPages(bytes: Buffer): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    return doc.getPageCount()
  } catch {
    throw BadRequest('invalid_pdf', 'Could not read that PDF — it may be corrupt or password-protected.')
  }
}
