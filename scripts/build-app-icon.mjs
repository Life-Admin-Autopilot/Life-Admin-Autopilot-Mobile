// Builds the platform icon/splash SOURCE images that `@capacitor/assets` fans
// out into every required size. Run via `npm run icons`.
//
// The mascot at assets/ghost/logo.png cannot be used directly as an app icon:
// it is 968x988 (not square) and has a transparent background. iOS requires a
// square 1024x1024 icon with NO alpha channel — transparency renders black on
// the home screen and is rejected at App Store submission. So we letterbox the
// mascot onto an opaque brand canvas here.
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const SOURCE = 'assets/ghost/logo.png'
const OUT_DIR = 'assets'

const ICON_SIZE = 1024
// @capacitor/assets expects a 2732x2732 splash and crops it per device.
const SPLASH_SIZE = 2732

// --background in app/globals.css, light (:root) and dark (.dark). Keeping the
// icon and splash on the same canvas as the app makes the launch feel
// continuous rather than like two products — and stops the dark-mode launch
// from flashing a near-white screen before the UI mounts.
const CANVAS = { r: 249, g: 248, b: 252, alpha: 1 }
const CANVAS_DARK = { r: 3, g: 3, b: 3, alpha: 1 }

// iOS masks icons to a squircle, so anything near the edge gets clipped. Apple's
// icon grid keeps key content within roughly the central 80%; 0.76 leaves the
// mascot comfortably inside the mask on both iOS and Android's circular crop.
const ICON_SUBJECT_RATIO = 0.76
// The splash is full-bleed, so the mascot sits much smaller within it.
const SPLASH_SUBJECT_RATIO = 0.3

async function render({ canvasSize, subjectRatio, outputPath, flatten, canvas: bg = CANVAS }) {
  const box = Math.round(canvasSize * subjectRatio)

  // `fit: 'inside'` preserves the mascot's 968:988 aspect ratio instead of
  // squashing it to square.
  const subject = await sharp(SOURCE)
    .resize(box, box, { fit: 'inside', withoutEnlargement: false })
    .toBuffer()

  const canvas = sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: bg,
    },
  }).composite([{ input: subject, gravity: 'centre' }])

  // flatten() composites against the canvas colour but sharp still emits an
  // (all-opaque) alpha channel, which iOS rejects — removeAlpha() is what
  // actually drops it to RGB. Verified via `sips -g hasAlpha`.
  const pipeline = flatten ? canvas.flatten({ background: bg }).removeAlpha() : canvas

  await pipeline.png().toFile(outputPath)
  return outputPath
}

await mkdir(OUT_DIR, { recursive: true })

const written = await Promise.all([
  render({
    canvasSize: ICON_SIZE,
    subjectRatio: ICON_SUBJECT_RATIO,
    outputPath: `${OUT_DIR}/icon.png`,
    flatten: true,
  }),
  // Android adaptive icons layer a transparent foreground over a solid
  // background, and the launcher applies its own mask — so this one keeps alpha.
  render({
    canvasSize: ICON_SIZE,
    subjectRatio: ICON_SUBJECT_RATIO,
    outputPath: `${OUT_DIR}/icon-foreground.png`,
    flatten: false,
  }),
  render({
    canvasSize: SPLASH_SIZE,
    subjectRatio: SPLASH_SUBJECT_RATIO,
    outputPath: `${OUT_DIR}/splash.png`,
    flatten: true,
  }),
  // Without this, @capacitor/assets derives the dark splash from the light one
  // and the app launches into a near-white flash before the dark UI mounts.
  render({
    canvasSize: SPLASH_SIZE,
    subjectRatio: SPLASH_SUBJECT_RATIO,
    outputPath: `${OUT_DIR}/splash-dark.png`,
    flatten: true,
    canvas: CANVAS_DARK,
  }),
])

await sharp({
  create: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    channels: 4,
    background: CANVAS,
  },
})
  .png()
  .toFile(`${OUT_DIR}/icon-background.png`)

console.log(
  `Built from ${SOURCE}:\n  ${[...written, `${OUT_DIR}/icon-background.png`].join('\n  ')}`,
)
