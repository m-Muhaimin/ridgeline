# AGENTS.md — RidgeLine

AI scheduling/dispatch assistant for solo tradespeople. Next.js App Router frontend (`apps/web/`,
port 3001), single-file Express **API-only** backend (`server.ts`, ~2.8k lines, port 3000), Neon
Postgres, Twilio, Gemini / OpenAI-compatible LLM.

## Commands

```bash
npm install --legacy-peer-deps   # root (API) deps
npm install --prefix apps/web    # web deps — a second, independent install
npm run dev          # tsx server.ts   ->  http://localhost:3000  (API + webhooks only)
npm run dev:web      # next dev -p 3001 ->  http://localhost:3001  (the UI)
npm run build:web    # next build  ->  apps/web/.next
npm run start:web    # next start -p 3001
npm start            # production Express; identical to `dev`, differs ONLY via NODE_ENV
npm test             # node --import tsx --test over packages/**/__tests__  (159 tests)
npm run lint         # this is just `tsc --noEmit`
```

- **Two processes, two ports.** Express (:3000) serves the API and the Twilio webhooks and *nothing
  else* — no static files, no SPA fallback. Next (:3001) serves the UI. `next.config.ts`
  `rewrites()` proxies **only** `/api/:path*` → `http://localhost:3000/api/:path*`, so the browser
  only ever talks to :3001 and there is no API base URL to configure or keep in sync.
- **Webhooks are deliberately NOT proxied.** Twilio talks to :3000 directly in dev, and in
  production the host routes `/webhooks/*` straight to Express. Adding a rewrite for them breaks
  `verifyTwilioSignature`, which builds its validation URL from the real host.
- **Cookies are per-host, not per-rewrite.** The `ridgeline_session` cookie the browser holds for
  `localhost:3001` is forwarded unchanged through the rewrite to Express, which is why the cookie
  path keeps working with no CORS configuration at all. Don't "fix" this by adding CORS headers.
- **Production is a host-level path split, not a rewrite:** `/api/*` + `/webhooks/*` → Express,
  everything else → Next. There is no single command that starts both processes.
- `PORT` is env-configurable with 3000 as the local-dev fallback (`server.ts:53-55`), so hosts that
  inject a dynamic port are honoured. The web scripts are pinned to 3001 by `apps/web/package.json`.
- Tests run on the real node test runner and are **server-side only** (`packages/`, 159 tests).
  There is **no ESLint, no Prettier, no CI, no husky, no browser-test setup** — `npm run lint`
  (which is `tsc --noEmit`) plus `npm test` is the entire verification story. The baseline **is
  clean** (verified: `npx tsc --noEmit` exits 0), so any error you see is yours — don't excuse it.
- **Keep `--legacy-peer-deps` on the root install.** The peer conflict that originally forced the
  flag is gone, but keep it anyway: root (`bun.lock`) and `apps/web` (`package-lock.json`) are two
  independent installs, and a bare `npm install` at the root writes a competing root lockfile next
  to the committed `bun.lock`.
- `tsconfig.json` has no `include`/`files`, so root `tsc` typechecks **everything together** —
  `server.ts`, `neon.ts`, `hello.ts`, `scripts/*.ts`, `packages/**`, *and* `apps/web/**` (566
  files). `apps/web` carries its own `tsconfig.json` for its own `npm run lint`. The old single-entry
  `types` array is gone, which restores the default "all `@types` packages" behaviour that keeps the
  Node globals `server.ts` and `scripts/*` rely on resolving. No `strict`. Lockfile is **TypeScript 7.x**.
- Lockfile is `bun.lock` (committed) but scripts are npm, and there's no `packageManager` field.
  Don't mix bun/npm installs casually — you'll get lock drift.

## Architecture

```
server.ts          Express API: all routes + AI pipeline + DB + auth  (monolith, no modules)
  initDb()         server.ts:2639-2816  inline DDL, runs on EVERY boot
  startServer()    server.ts:2821-2846  initDb -> /api/* JSON-404 guard -> listen
apps/web/          Next.js App Router frontend (own package.json, own tsconfig, port 3001)
  next.config.ts   rewrites(): /api/:path* -> http://localhost:3000/api/:path*
  app/(dashboard)/ the seven main views, one real route each
  app/(auth)/      /auth, /onboarding
  components/      20 components (shadcn-style `ui/` only has button.tsx + sidebar.tsx)
  lib/             apiFetch.ts, chartUtils.ts, triage.ts, timezones.ts, utils.ts
  types.ts         the ONLY client-side type contract
  mockData.ts      in-memory baseline data & fallback state
packages/          domain/application/server logic + the whole test suite
scripts/           migrate.ts, migrate-auth.ts, backfill-booking-instents.ts (not in package.json)
supabase/migrations/  20260927000000_init_ridgeline_schema.sql
neon.ts + hello.ts + .neon   vestigial Neon Functions scaffold (a file, not a dir) — don't build on it
```

- **`server.ts` and `apps/web/` are fully decoupled — no shared types.** `server.ts` imports nothing
  from `apps/web/`, and every request body is untyped `any`. `apps/web/types.ts` is an independent
  mirror. Any API contract change must be made on **both** sides by hand.
- **Routing is real now.** Each view is its own App Router route (`/`, `/dispatch`, `/sms`,
  `/missed-calls`, `/customers`, `/services`, `/settings`) plus `(auth)/auth` and
  `(auth)/onboarding`, so deep links and back/forward work. The old single-page `activeTab` state
  machine is gone; adding a view means adding a route, not a tab.
- **All web-side API calls go through `apiFetch()` (`apps/web/lib/apiFetch.ts`)** — never bare
  `fetch(...).json()`. It checks `res.ok` and `content-type` first, so a missing/misrouted backend
  reports a readable error instead of `Unexpected token 'T', "The page c"... is not valid JSON`. Keep
  new call sites on it. It always targets a relative `/api/...` path, which the rewrite forwards.
- **Cross-view state lives in `apps/web/components/DataProvider.tsx`** (a context provider), not in
  a single giant component — server components under `app/` render inside that provider.
- **`server.ts` ends `startServer()` with a JSON 404 for unmatched `/api/*`**, and that guard is now
  the last middleware before `listen`. It exists because an unknown API path must fail as JSON
  rather than as an HTML error page. Register new routes at module scope (before `startServer()`
  runs), not inside it, or the 404 will swallow them.

## The silent-fallback trap (read this before debugging "it works")

Every external dependency degrades to mock data instead of erroring, so a misconfigured server
looks like a working one:

| Missing | What happens |
|---|---|
| `DATABASE_URL` | `pool` stays `null`; `initDb()` returns immediately; every route serves hardcoded `inMemory*` arrays; `requireAuth` falls back to `inMemoryUsers[0]`. **Nothing persists.** |
| `OPENAI_COMPATIBLE_*` | Falls back to Gemini (`@google/genai`), then a deterministic rule-based responder. |
| `GEMINI_API_KEY` | `ai` stays `null`; that fallback tier is skipped. |
| `TWILIO_*` | `twilioClient` is `null`; nothing is actually sent. |

Check `GET /api/health` and `GET /api/neon/status` (through :3001, or :3000 directly) plus the
server boot log before concluding a feature works. `toUuid()`
(`packages/application/id-utils.ts:22`) md5-hashes non-UUID input into a *stable* UUID, which is why
in-memory IDs look real and survive restarts.

## Database & migrations

- **The schema lives in three places that must be kept in sync by hand:** inline DDL in
  `initDb()`, `supabase/migrations/20260927000000_init_ridgeline_schema.sql`, and
  `scripts/migrate.ts`. Adding a table/column means editing all three, or the next server boot
  will silently patch around you.
- **`initDb()` runs on every boot** — it creates schema `app`, tenant helper functions, the
  `ridgeline_app` role, tables, indexes, and RLS policies. It also `DROP POLICY IF EXISTS` +
  recreate, so a hand-written policy tweak gets reverted on restart.
- Migration scripts are **not** in `package.json`. Run them explicitly:
  `npx tsx scripts/migrate.ts` / `npx tsx scripts/migrate-auth.ts`.
- `scripts/migrate.ts` **hardcodes one filename** (`20260927000000_init_ridgeline_schema.sql`).
  A newly added migration file is silently ignored until that line is updated.
- Multi-tenancy: `runTenantQuery()` (`packages/application/tenant-context.ts:11`) wraps each query in
  a txn, sets `app.current_organization_id` / `app.current_user_id` via `set_config`, then
  `SET LOCAL ROLE ridgeline_app` so RLS actually applies. Go through it; don't call `pool.query`
  directly.
- Env loading is `dotenv.config({path:'.env.local'})` then `dotenv.config()` — **relative paths, so
  cwd must be the repo root.** `.env.local` wins (dotenv doesn't override). `.gitignore` covers
  `.env*` except `.env.example`.
- **The root `package-lock.json` was removed (2026-09); `bun.lock` is the only root lockfile.** A bare
  `npm install` at the root regenerates a competing `package-lock.json` next to it. Keep the
  `--legacy-peer-deps` habit for the root install, and prefer `bun install` to sync root deps (needs
  bun on PATH — `npm install -g bun` if missing). `apps/web/package-lock.json` is a separate,
  intentional install and is expected to exist.

## Auth

- `requireAuth` accepts the `ridgeline_session` cookie **or** `Authorization: Bearer <jwt>`. The
  web app mirrors the token into `localStorage.ridgeline_session_token` and sends it as a Bearer
  header alongside `credentials: 'include'`. Both paths are live — keep them working.
- Passwords: PBKDF2-SHA512, 1000 iterations, 16-byte salt, stored as `salt:hash`.
- `JWT_SECRET` / `SESSION_SECRET` / `COOKIE_SECRET` are **listed in `.env.example` as placeholders**
  and must be set to long random values (e.g. `openssl rand -hex 32`) in any shared or deployed
  environment. When they are unset the server still falls back to hardcoded constants — one of which
  is literally named `...-production` — so never rely on the fallback.
- Unauthenticated routes (no `requireAuth` middleware): `/api/auth/register`, `/api/auth/login`,
  `/api/auth/logout`, `/api/auth/me` (does its own cookie/Bearer check and answers
  `{ user: null }` rather than 401), `/api/health`, `/api/neon/status`,
  `/api/neon/test-function`, and the three `/webhooks/twilio/*` (guarded by
  `verifyTwilioSignature` instead). Don't add new unauthenticated routes casually.
- **`/api/sms/process` and `/api/missed-call/process` are no longer public.** Both run the LLM
  pipeline, so they are `requireAuth` + `requirePermission('assistant.run')` + per-org rate limited.
  Real inbound calls arrive via `/webhooks/twilio/voice`; those two routes are the simulator only.

## AI pipeline

- `runSmsAssistant()` (`packages/application/ai-pipeline.ts:144`) is the shared pipeline:
  **OpenAI-compatible → Gemini (`@google/genai`) → deterministic rule-based fallback.**
  Per-org overrides (`llmProvider`, `openaiBaseUrl`, `openaiApiKey`, `openaiModel`) come from
  `assistant_settings` and win over env.
- The prompt demands a strict JSON schema; responses are fence-stripped then `JSON.parse`d.
- **Client-supplied LLM config is stripped server-side** on the simulator routes
  (`stripServerOnlyAssistantKeys`), so `settings.openaiApiKey` / `baseUrl` / `llmProvider` arriving
  in a request body are dropped and env-driven config is used instead. This closed the SSRF
  primitive the old test-endpoint route exposed. Don't re-add a client-writable `baseUrl`.
- `DEFAULT_OPENAI_API_KEY` (`packages/application/ai-pipeline.ts:30`) is now **env-only**
  (`process.env.OPENAI_COMPATIBLE_API_KEY || ''`) and `apps/web/mockData.ts:56` ships
  `openaiApiKey: ''` — the previously hardcoded key is gone from both server and client. Verify with
  `rg "sk-"` before trusting any doc that says otherwise.
- `scripts/migrate-auth.ts` seeds a demo user with a **hardcoded password committed to the repo**.
  Rotate/remove before any real deployment.

## Twilio

- Webhooks use a scoped `express.urlencoded` parser (`twilioFormParser`) mounted per-route;
  the global `express.json()` only applies to `/api/*`. Don't move webhook routes above the
  global JSON parser.
- `verifyTwilioSignature` **bypasses verification** when `TWILIO_AUTH_TOKEN` is unset and
  `NODE_ENV !== 'production'`; in production it hard-fails with 500. Don't rely on the dev bypass.
- The validation URL prefers `APP_URL` over request host — set `APP_URL` in any proxied
  deployment or signatures will mismatch. This is also why webhooks bypass the Next rewrite.

## Known drift

- `README.md`'s project tree is accurate about `scripts/` and `packages/` now that the Next.js
  migration landed, but it still omits the vestigial scaffold (`neon.ts`, `hello.ts`, `.neon`) and
  the `PRD.md` / `IMPLEMENTATION.md` docs. Trust the code, not the tree.
- `README.md`, `.env.example`, and code carry neutral placeholder values only. If you see a live-looking
  host, URL, or ID in a doc/env file, it was re-introduced — remove it and use a placeholder. That
  includes defaults baked into code (`ai-pipeline.ts`, `mockData.ts`, `server.ts`): no live
  third-party host may be a functional default.
- **The old `/api/neon/execute-sql` and `/api/ai/test-endpoint` routes no longer exist.** Both were
  removed when the SSRF/caller-supplied-SQL surface was closed; `rg "execute-sql|test-endpoint"
  server.ts` returns only comments referring to the route that "used to" exist. The unauthenticated
  surface that remains is the list in **Auth** above. If you add a debug route, remember there is no
  longer a safe precedent to copy.
- `apps/web/components/DataProvider.tsx` seeds every collection from `apps/web/mockData.ts` and then
  overwrites from `/api/neon/data`. There are two sources of truth for each list during startup.
- `apps/web/components/DataProvider.tsx` still carries inline `// App.tsx:NN` line-number annotations
  referring to the deleted single-page orchestrator. Its file header no longer does — that now
  describes the provider accurately — but the annotations are stale references. Harmless, but don't
  grep for `src/` to find them.
- **Two processes, not one.** The host must run **both** `npm start` (Express) and
  `npm run start:web` (Next). A Next-only host serves the app shell and 404s every `/api/*` call —
  the app "loads but all data is broken". A Express-only host answers `/` with its own 404, which is
  correct and expected. If the UI loads and data is broken, check that the API process is actually
  deployed before debugging the frontend. There is no `vercel.json`/`render.yaml`/`Dockerfile` in the
  repo — deployment is currently unconfigured and host-specific.
