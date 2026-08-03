// Vendors the pdf.js runtime assets the WORKER fetches at runtime into
// public/pdfjs/, so they ship inside the Capacitor bundle.
//
// These cannot be imported through the bundler. pdf.js resolves them itself,
// from inside the worker thread, by string URL — so they have to exist as real
// files under a stable public path. `/pdfjs/...` resolves correctly in all three
// hosts the app runs in: `next dev` (served from public/), the static export on
// the web, and `capacitor://localhost` where the export IS the bundle root.
//
// A CDN is not an option: the app must open a scan with no network (the bytes
// are already local), and the CSP self-hosts everything.
//
// Generated, not source — public/pdfjs/ is gitignored and rebuilt by the
// `pdfjs:assets` npm script, which `postinstall` and every build entry run.

import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const dest = resolve(process.cwd(), 'public/pdfjs')

// The `legacy` build, deliberately. Capacitor's WebView version tracks the OS,
// not the app, so the floor here is whatever Android/iOS release a user happens
// to be on — the modern build assumes a browser baseline we do not control.
//
// `standard_fonts` and `cmaps` are what keep a real bill legible: a PDF that
// references Helvetica without embedding it, or uses CID-keyed text (the app
// ships Arabic), renders blank or tofu without them. `wasm` decodes JBIG2 and
// JPEG 2000 — the exact codecs scanners and fax-to-PDF pipelines emit, which is
// this app's whole input domain. `iccs` is colour management for tagged CMYK.
const ASSETS = [
  { from: 'legacy/build/pdf.worker.min.mjs', to: 'pdf.worker.min.mjs' },
  { from: 'cmaps', to: 'cmaps' },
  { from: 'standard_fonts', to: 'standard_fonts' },
  { from: 'wasm', to: 'wasm' },
  { from: 'iccs', to: 'iccs' },
]

async function main() {
  await rm(dest, { recursive: true, force: true })
  await mkdir(dest, { recursive: true })

  for (const asset of ASSETS) {
    const from = join(pdfjsRoot, asset.from)
    // Fail loudly rather than shipping a viewer that renders blank pages: a
    // pdfjs-dist upgrade that moves or renames one of these is exactly the kind
    // of break that otherwise only surfaces on a user's device.
    try {
      await stat(from)
    } catch {
      throw new Error(
        `pdf.js asset missing: ${asset.from}\n` +
          `Looked in ${pdfjsRoot}. A pdfjs-dist upgrade probably moved it — ` +
          `update ASSETS in scripts/copy-pdfjs-assets.mjs.`,
      )
    }
    await cp(from, join(dest, asset.to), { recursive: true })
  }

  console.log(`pdf.js assets → public/pdfjs/ (${ASSETS.length} entries)`)
}

await main()
