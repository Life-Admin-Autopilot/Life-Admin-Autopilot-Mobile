// Probe: run scratch/test-bill.pdf through the real document extractor and
// print what came back. One Gemini call. Usage: npx tsx scratch/probe-doc-extract.ts
import 'dotenv/config'
import { readFile } from 'node:fs/promises'

import { extractDocumentCandidates } from '../src/modules/ai/documentCore/extract'

async function main() {
  const bytes = await readFile('scratch/test-bill.pdf')
  const result = await extractDocumentCandidates({
    bytes,
    mimeType: 'application/pdf',
    timezone: 'Europe/London',
  })

  console.log('\nsummary:', result.documentSummary ?? '(none)')
  console.log(`\n${result.candidates.length} candidates:\n`)
  for (const c of result.candidates) {
    console.log(
      `p${c.sourcePage ?? '?'}  [${c.domain}/${c.priority}/${c.confidence}]  ${c.title}\n` +
        `      due: ${c.dueAt?.toISOString() ?? 'null'}\n` +
        `      ${c.notes ?? '(no notes)'}\n`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
