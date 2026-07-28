import sharp from 'sharp'

import type { PdfPage } from './buildDocumentPdf'

// Some scans are photographs, not PDFs — and the two render through completely
// different paths in OriginalDocumentPeek: an image gets a real thumbnail and
// an in-app lightbox, a PDF gets a file icon and opens in a new tab. A dataset
// of nothing but PDFs leaves half of that component unexercised.
//
// sharp is resolved from the repo root's node_modules (Node walks up from
// server/), so this adds no dependency to server/package.json.

const WIDTH = 1240
const HEIGHT = 1754

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function buildDocumentPhoto(page: PdfPage): Promise<Buffer> {
  const lines: string[] = []
  let y = 210

  const push = (text: string, size: number, weight: string, fill: string): void => {
    lines.push(
      `<text x="140" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(text)}</text>`,
    )
    y += Math.round(size * 1.75)
  }

  push(page.heading, 44, 'bold', '#111111')
  push(page.contact, 22, 'normal', '#777777')
  y += 20
  lines.push(`<line x1="140" y1="${y}" x2="1100" y2="${y}" stroke="#cccccc" stroke-width="2"/>`)
  y += 60

  for (const [label, value] of page.fields) {
    lines.push(
      `<text x="140" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="bold" fill="#555555">${escapeXml(label)}</text>`,
      `<text x="560" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="27" fill="#111111">${escapeXml(value)}</text>`,
    )
    y += 48
  }

  y += 40
  lines.push(`<line x1="140" y1="${y}" x2="1100" y2="${y}" stroke="#cccccc" stroke-width="2"/>`)
  y += 60

  for (const line of page.body) push(line, 26, 'normal', '#222222')
  y += 30
  push(page.footer, 20, 'normal', '#888888')

  // A faint vignette and an off-white paper tone: a phone photo of a document
  // is never a pure #fff scan, and the thumbnail should look like one.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
    <defs>
      <radialGradient id="v" cx="50%" cy="45%" r="75%">
        <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.16"/>
      </radialGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="#f6f4ef"/>
    ${lines.join('\n')}
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#v)"/>
  </svg>`

  return sharp(Buffer.from(svg)).jpeg({ quality: 78 }).toBuffer()
}
