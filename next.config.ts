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
  experimental: {
    // Keep build/dev worker fan-out low on laptops and low-memory machines.
    // This app is a static export and does not need aggressive parallelism.
    cpus: 1,
    webpackBuildWorker: false,
  },
}

export default nextConfig
