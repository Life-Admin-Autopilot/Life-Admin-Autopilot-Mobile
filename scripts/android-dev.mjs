#!/usr/bin/env node
// Run the app on an Android device or emulator with live reload against
// `next dev`.
//
//   npm run android:dev                     resolve the LAN IP automatically
//   KITTO_DEV_HOST=10.0.2.2 npm run android:dev    force a host
//
// Node rather than a shell one-liner because `npm run` uses cmd.exe on Windows,
// where the previous form — cross-env with a $(...) substitution — could not
// work at all. The address it used was also hard-coded from another machine,
// so it was wrong everywhere except the laptop it was written on.
//
// 10.0.2.2 is the emulator's alias for its host. A physical phone needs the
// real LAN address instead, which is the default here.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lanIp } from './lan-ip.mjs'

if (!existsSync('android')) {
  console.error('No android/ folder — it is generated, not committed.\n')
  console.error('  npx cap add android\n')
  console.error('Then copy google-services.json into android/app/ or push')
  console.error('notifications will not register.')
  process.exit(1)
}

// Self-healing rather than merely warning: the durable copy lives at
// native/android/, because android/ is regenerated and loses anything put in it
// by hand. Still not fatal when neither exists — everything except push works
// without it, and stopping here would block a teammate who only wants to see
// the app on a phone.
spawnSync(process.execPath, ['scripts/patch-android-firebase.mjs'], { stdio: 'inherit' })

const host = process.env.KITTO_DEV_HOST || lanIp()

if (!host) {
  console.error('Could not work out this machine\'s LAN address.')
  console.error('Set one explicitly:  KITTO_DEV_HOST=192.168.1.5 npm run android:dev')
  process.exit(1)
}

const url = `http://${host}:3000`
console.log(`Live reload from ${url}`)
console.log('`npm run dev` must already be running, and the backend must allow')
console.log(`${url} in Kernel__Cors__Origins.\n`)

// shell:true so `npx` resolves through .cmd on Windows.
const child = spawn('npx', ['cap', 'run', 'android'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CAP_LIVE_RELOAD_URL: url },
})

child.on('exit', (code) => process.exit(code ?? 1))
