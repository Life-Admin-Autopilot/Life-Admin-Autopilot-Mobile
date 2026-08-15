# Setting up a new machine

From nothing to the app running in a browser and on your phone. If you only
want the web app, stop after step 4 and run `npm run app -- --web`.

There are **two repos** and they must sit **next to each other**:

```text
any-folder/
├── Life-Admin-Autopilot-Mobile/     ← the app (this repo)
└── Life-Admin-Autopilot-Backend/    ← the .NET API
```

Side by side is what matters, not the names. `npm run app` finds the backend by
looking for `Life-Admin-Autopilot-Backend.slnx` in the sibling folders, so a
clone named `Steward` or `backend` is fine. Somewhere else entirely also works:

```bash
KITTO_BACKEND_DIR=/path/to/backend npm run app
```

## 1. Install the prerequisites

| | All platforms | macOS only | Windows only |
|---|---|---|---|
| Required | Node 20+, .NET SDK 10, Docker Desktop, Git | — | Git Bash (ships with Git for Windows) |
| For a phone | — | Xcode (iOS) | Android Studio (Android) |

**iOS builds need Xcode, and Xcode needs macOS.** On Windows you get Android.
`npm run app` picks the right one for your OS without being told.

Docker must be **running**, not just installed — `npm run app` checks the daemon,
not the CLI.

## 2. Clone both repos

```bash
git clone https://github.com/Life-Admin-Autopilot/Life-Admin-Autopilot-Mobile.git
git clone https://github.com/Life-Admin-Autopilot/Life-Admin-Autopilot-Backend.git
```

## 3. Configure the backend

```bash
cd Life-Admin-Autopilot-Backend
cp .env.example .env
```

Now fill in `.env`. **Read the comments in it** — each block says what goes dark
without that key, so you can start with fewer and add as you need them. Secrets
are handed over out of band; they are deliberately not in the repo.

You do **not** need to set `Kernel__Cors__Origins`. `npm run app` passes your
machine's LAN origin automatically, and `up.sh` fills in the local ones. This is
worth knowing because getting it wrong is invisible: the allowlist defaults to
empty and a request with no `Origin` header is allowed, so `curl` and `/health`
look perfectly healthy while every call from the app is refused.

First run pulls the Mongo and Langflow images, so give it a few minutes. See
`docs/RUNNING.md` in that repo for what each container does.

## 4. Configure the app

```bash
cd ../Life-Admin-Autopilot-Mobile
npm install
```

That is all for the web. You do **not** need `.env.local` — without it the app
uses `.env`, which points at port 4000, the same port `up.sh` serves on.

If you create a `.env.local`, `npm run app` follows the port you put there and
starts the backend on it, so the two cannot drift.

## 5. Run it

```bash
npm run app
```

It brings up the backend, starts the site, syncs the native shell, and opens
Xcode or Android Studio. Press ▶ there and the app live-reloads from the site —
edit a file, the phone updates.

```bash
npm run app -- --web       # site only, no phone, no IDE
npm run app -- --android   # force Android (works on macOS too)
npm run app -- --skip-backend
npm run app -- --host 192.168.1.5   # if LAN detection picks the wrong adapter
npm run app -- --help
```

**Your phone must be on the same Wi-Fi as your computer.** Everything is
addressed by LAN IP rather than localhost, because a phone resolves localhost to
itself. Guest networks and some corporate Wi-Fi isolate clients from each other
and will not work.

`android/` and `ios/` are generated, not committed. `npm run app` creates
whichever it needs on first run.

## 6. Push notifications (optional)

**Android** — ask the team for `google-services.json` and put it at
`native/android/google-services.json`. Not in `android/`: that folder is
regenerated and would lose it. `npm run app` copies it into place on every sync.

The backend also needs a Firebase **service-account key** (a different file) in
`FCM_SERVICE_ACCOUNT_FILE`. Without it the device registers and nothing is ever
sent.

**iOS** — push needs an APNs key, which needs a **paid** Apple Developer
membership. Until then iOS delivers reminders as local notifications scheduled
on the device. That is the intended design, not a broken setup: it fires with the
app closed and needs no certificate. Nothing needs configuring for it.

## When it does not work

**`✗ ... never came up`** — read the line above it. The backend leg prints
whether it started something or found one already running.

**The app hangs on the ghost splash.** The dev server is unreachable from the
phone, or its origin is not trusted. Check you are on the same Wi-Fi, then run
`npm run ios:check --device`, which tests the whole chain and prints the fix.

**Every request fails but `/health` is fine.** CORS. The allowlist is read once
at startup, so a backend started *before* you knew your LAN IP has to be
restarted — stop it and re-run `npm run app`.

**LAN IP changed** (new Wi-Fi, tethering). Just re-run `npm run app`; it
re-detects and re-syncs. Nothing is hard-coded.

**iOS app stops launching after a week.** Free Apple provisioning expires after
7 days. Re-run from Xcode.

**Android build fails mentioning google-services.** `package_name` in your
`google-services.json` must match `com.kitto.app`.
