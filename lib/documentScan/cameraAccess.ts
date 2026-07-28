// Camera permission + capture outcomes for the document scan flow.
//
// @capacitor/camera's getPhoto() rejects for three very different reasons and
// gives them all a plain Error: the user denied camera access, the user simply
// backed out of the camera sheet, or the capture genuinely failed. Collapsing
// those into one "Could not process that scan." message is what made a denied
// permission (and a harmless cancel) look like a broken scanner.
//
// Nothing here imports @capacitor/camera at module scope — the native bridge is
// dynamically imported by the caller, so this file stays safe on the web.

export type CameraOutcome = 'granted' | 'denied' | 'cancelled' | 'unavailable'

// Capacitor surfaces cancellation as a message string rather than a code, and
// the wording differs between iOS and Android.
const CANCEL_MARKERS = ['cancel', 'no image picked', 'no image selected']

export function isCancellation(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  return CANCEL_MARKERS.some((marker) => message.includes(marker))
}

// The camera is genuinely absent on the iOS Simulator, so `getPhoto` there
// fails no matter what the permission state says. Worth its own message so a
// simulator run doesn't read as a permission bug.
const UNAVAILABLE_MARKERS = ['not available', 'unavailable', 'no camera', 'simulator']

export function isCameraUnavailable(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  return UNAVAILABLE_MARKERS.some((marker) => message.includes(marker))
}

// Structurally matches the slice of CameraPlugin we use, without importing the
// native module here. `photos` is part of the plugin's PermissionStatus even
// though only `camera` matters to this flow.
interface CameraPermissionState {
  camera: string
  photos: string
}

interface CameraPermissionApi {
  checkPermissions: () => Promise<CameraPermissionState>
  requestPermissions: (options?: { permissions: ('camera' | 'photos')[] }) => Promise<CameraPermissionState>
}

/**
 * Resolve camera access before opening the capture sheet.
 *
 * getPhoto() does prompt on its own the first time, but once a user has denied
 * it, it rejects instantly with an opaque error and no way back. Checking first
 * lets the UI say "enable this in Settings" instead of "could not process".
 */
export async function ensureCameraAccess(camera: CameraPermissionApi): Promise<CameraOutcome> {
  try {
    const current = await camera.checkPermissions()
    if (current.camera === 'granted' || current.camera === 'limited') return 'granted'
    if (current.camera === 'denied') return 'denied'

    // 'prompt' / 'prompt-with-rationale' — ask now so the rejection below is
    // unambiguous rather than tangled up with the capture itself.
    const requested = await camera.requestPermissions({ permissions: ['camera'] })
    if (requested.camera === 'granted' || requested.camera === 'limited') return 'granted'
    return 'denied'
  } catch {
    // checkPermissions throws on platforms without the native plugin.
    return 'unavailable'
  }
}

export function cameraDeniedMessage(appName: string): string {
  return `${appName} needs camera access to scan documents. Enable it in Settings → Privacy & Security → Camera.`
}
