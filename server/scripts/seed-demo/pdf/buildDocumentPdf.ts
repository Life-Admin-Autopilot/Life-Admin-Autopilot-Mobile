import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// Real bytes for every seeded scan.
//
// /documents has a working viewer — OriginalDocumentPeek fetches
// GET /me/document-scans/:id/file and streams whatever is on disk. A seeded
// row with no file behind it turns "view the original" into a 500 on a screen
// we are specifically here to evaluate, so each scan gets an actual PDF.

export interface PdfPage {
  heading: string
  contact: string
  /** `[label, value]` rows rendered as a definition block. */
  fields: [string, string][]
  /** Free paragraph lines under the fields. */
  body: string[]
  footer: string
}

const LEFT = 56
const RIGHT = 556
const TOP = 748

export async function buildDocumentPdf(pages: PdfPage[]): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)

  for (const spec of pages) {
    const page = doc.addPage([612, 792])
    let y = TOP

    const write = (
      text: string,
      opts: { size?: number; font?: typeof regular; gap?: number; grey?: number } = {},
    ): void => {
      const { size = 11, font = regular, gap = 17, grey } = opts
      page.drawText(text, {
        x: LEFT,
        y,
        size,
        font,
        color: grey === undefined ? rgb(0, 0, 0) : rgb(grey, grey, grey),
      })
      y -= gap
    }

    const rule = (): void => {
      page.drawLine({
        start: { x: LEFT, y: y + 8 },
        end: { x: RIGHT, y: y + 8 },
        thickness: 0.5,
        color: rgb(0.75, 0.75, 0.75),
      })
      y -= 18
    }

    write(spec.heading, { size: 19, font: bold, gap: 15 })
    write(spec.contact, { size: 9, grey: 0.45, gap: 22 })
    rule()

    for (const [label, value] of spec.fields) {
      page.drawText(label, { x: LEFT, y, size: 10, font: bold, color: rgb(0.3, 0.3, 0.3) })
      page.drawText(value, { x: LEFT + 190, y, size: 11, font: regular, color: rgb(0, 0, 0) })
      y -= 19
    }

    y -= 8
    rule()

    for (const line of spec.body) write(line, { gap: 16 })

    y -= 10
    write(spec.footer, { size: 9, grey: 0.5, gap: 12 })
  }

  return Buffer.from(await doc.save())
}
