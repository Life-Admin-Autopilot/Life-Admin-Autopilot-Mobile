# life-admin-server

Express + Mongoose backend for Life Admin Autopilot. Provides email/password
and magic-link authentication, plus profile read/update endpoints. The React
Native app under `../` consumes this API.

## Quick start

```bash
# 1. Install deps
npm install

# 2. Bring up MongoDB
brew install mongodb-community
brew services start mongodb-community
# (or use an Atlas connection string)

# 3. Configure env
cp .env.example .env
# Then fill in JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, RESEND_API_KEY (optional)

# 4. Run dev server
npm run dev
# → server:listening on :4000

# 5. Verify
curl -s http://localhost:4000/health | jq
```

## Scripts

- `npm run dev` — tsx watch mode, restarts on changes
- `npm run build` — compile to `dist/`
- `npm start` — run compiled output
- `npm run type-check` — `tsc --noEmit`
- `npm test` — vitest

## Layout

```
src/
├── index.ts                # entrypoint
├── app.ts                  # express app factory
├── env.ts                  # zod-validated env
├── db.ts                   # mongoose connect
├── logger.ts               # pino
├── lib/
│   └── errors.ts           # AppError + asyncHandler
├── middleware/
│   ├── errorHandler.ts     # final error mw
│   └── rateLimit.ts        # request limiters
├── models/                 # Mongoose schemas
└── routes/                 # route handlers
```

## Conventions

- Strict TypeScript, CommonJS output.
- Errors thrown as `AppError(status, code, message)` — final middleware
  translates to `{ error: { code, message, details? } }`.
- Zod schemas live next to the route they validate; route handlers call
  `Schema.parse(req.body)` inline. Validation failures bubble to the error
  handler as `ZodError` and are translated to a 400.
- Passwords hashed with argon2id. Refresh tokens stored as SHA-256 hash, never
  raw.
