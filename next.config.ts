import type { NextConfig } from 'next'

// Kitto V2 ships as a static-exported client SPA so Capacitor can bundle the
// `out/` directory into the native iOS/Android shells. There is NO Node server
// on-device: all dynamic behavior is client-side + the separate Express
// backend over HTTP. See docs/ARCHITECTURE.md and AGENTS.md ("Static-export
// discipline"). Consequences:
//   - no Next.js API routes for app logic, no server components doing I/O
//   - images can't be optimized on-device → `unoptimized`
//   - trailingSlash keeps static paths Capacitor-friendly (folder/index.html)
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,

  // Dev-only. `npm run app` serves `next dev` on the LAN so a phone can load it
  // via Capacitor live-reload, and Next blocks dev-asset requests from origins
  // it does not recognise — localhost is trusted, a LAN IP is not.
  //
  // The failure is silent and looks like a backend outage: the first paint
  // succeeds, then the client-side navigation off the boot splash fetches its
  // route payload from /_next, that request is blocked, and the app sits on the
  // splash forever. Nothing errors in the UI. The HMR WebSocket failing is the
  // visible tell.
  //
  // scripts/app.mjs passes the detected LAN IP; empty for plain `npm run dev`,
  // which only ever serves localhost.
  allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
}

export default nextConfig
