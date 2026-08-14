// PCM → WAV, because the ASR endpoint only accepts wav/mp3.
//
// Why we encode from raw PCM instead of converting MediaRecorder's output:
// `decodeAudioData` cannot reliably decode the WebM/Opus that MediaRecorder
// produces (it rejects with "Unable to decode audio data"), and the container it
// hands us differs per engine anyway — webm/opus on Chrome, mp4 on Safari. The
// recorder therefore taps the audio graph and keeps the samples, so there is no
// container to decode and no codec support to depend on.
//
// Pure: no WebAudio, no DOM beyond Blob. The capture side lives in
// useVoiceRecorder.ts.

/** 16 kHz mono is what ASR models want, and it is ~6x smaller than 48 kHz stereo. */
export const TARGET_SAMPLE_RATE = 16_000

/**
 * Flatten the captured buffers and resample to {@link TARGET_SAMPLE_RATE}.
 *
 * Hardware runs at 44.1 or 48 kHz, so the ratio is fractional and picking the
 * nearest sample would add audible jitter. Linear interpolation between the two
 * neighbours is cheap and good enough for speech.
 */
export function resampleToTarget(chunks: readonly Float32Array[], sourceRate: number): Float32Array {
  let total = 0
  for (const c of chunks) total += c.length
  const source = new Float32Array(total)
  let at = 0
  for (const c of chunks) {
    source.set(c, at)
    at += c.length
  }

  if (sourceRate === TARGET_SAMPLE_RATE || source.length === 0) return source

  const ratio = sourceRate / TARGET_SAMPLE_RATE
  const outLength = Math.floor(source.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, source.length - 1)
    const weight = position - left
    out[i] = source[left] * (1 - weight) + source[right] * weight
  }
  return out
}

/** Canonical 44-byte RIFF/WAVE header followed by little-endian 16-bit samples. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  const dataBytes = samples.length * bytesPerSample
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true) // file size minus the first 8 bytes
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk length
  view.setUint16(20, 1, true) // format 1 = uncompressed PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // byte rate
  view.setUint16(32, bytesPerSample, true) // block align
  view.setUint16(34, 8 * bytesPerSample, true) // bits per sample
  writeAscii(36, 'data')
  view.setUint32(40, dataBytes, true)

  // Clamp before scaling: captured audio can sit slightly outside [-1, 1], which
  // wraps to the opposite sign as an int16 and becomes an audible click.
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

/** The whole capture, as a WAV file the backend accepts. */
export function pcmToWav(chunks: readonly Float32Array[], sourceRate: number): Blob {
  return encodeWav(resampleToTarget(chunks, sourceRate), TARGET_SAMPLE_RATE)
}
