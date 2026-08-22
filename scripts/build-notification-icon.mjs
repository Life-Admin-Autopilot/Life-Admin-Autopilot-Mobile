// Builds the Android status-bar icon FROM the mascot, as a white silhouette
// with the eyes punched out. Run via `npm run icons`.
//
// Why it cannot just be the mascot PNG: since Android 5 the system redraws a
// notification's small icon using ONLY its alpha channel, filling every opaque
// pixel with one flat colour. Hand the full-colour ghost over and it arrives as
// a solid white blob — every pixel of it is opaque, so every pixel gets filled.
//
// So the shape has to carry the recognition, which means the eyes must be HOLES
// rather than lighter paint. The mascot's pupils are the darkest thing in the
// image and sit inside the body, so thresholding on luminance finds them
// without any hand-placed coordinates — and the drawing stays the real mascot
// rather than an approximation of it that drifts when the art changes.
//
// The output replaces an earlier hand-authored vector that was a generic
// Material bell, and then a hand-drawn ghost that did not look like Kitto.
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SOURCE = 'assets/ghost/logo.png'
const OUT_ROOT = 'native/android/res'

// 24dp at each density — the size Android expects for a status-bar icon.
const DENSITIES = [
  ['drawable-mdpi', 24],
  ['drawable-hdpi', 36],
  ['drawable-xhdpi', 48],
  ['drawable-xxhdpi', 72],
  ['drawable-xxxhdpi', 96],
]

// Render big, threshold, then downscale: deciding opacity at 96px loses the
// pupils to antialiasing on the smaller densities.
const WORK = 512

const OPAQUE_AT = 128 // alpha above this counts as part of the ghost
const PUPIL_BELOW = 95 // luminance below this is a pupil, and becomes a hole

async function main() {
  const { data, info } = await sharp(SOURCE)
    .resize(WORK, WORK, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const px = info.width * info.height
  const out = Buffer.alloc(px * 4)
  let kept = 0
  let holes = 0

  for (let i = 0; i < px; i += 1) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    const a = data[i * 4 + 3]

    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const solid = a > OPAQUE_AT && luminance >= PUPIL_BELOW

    // Flat white everywhere; only the alpha carries the drawing, because only
    // the alpha survives the system's redraw.
    out[i * 4] = 255
    out[i * 4 + 1] = 255
    out[i * 4 + 2] = 255
    out[i * 4 + 3] = solid ? 255 : 0

    if (solid) kept += 1
    else if (a > OPAQUE_AT) holes += 1
  }

  if (kept === 0) throw new Error('Silhouette came out empty — check OPAQUE_AT against the source art.')
  if (holes === 0) console.warn('! No pupils found — the icon will be a featureless blob. Check PUPIL_BELOW.')

  const silhouette = sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })

  for (const [dir, size] of DENSITIES) {
    const target = join(OUT_ROOT, dir)
    await mkdir(target, { recursive: true })
    await silhouette
      .clone()
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(join(target, 'ic_stat_kitto.png'))
    console.log(`  ${dir}/ic_stat_kitto.png  ${size}x${size}`)
  }

  console.log(`✓ status-bar icon built from ${SOURCE} (${kept} solid px, ${holes} punched out)`)
}

await main()
