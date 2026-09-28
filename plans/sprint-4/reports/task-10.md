# Task 10 — Remove the Vite frontend; make Next the web app

**Status:** COMPLETE. All static gates pass. No server was booted (controller runs runtime verification).

| Gate | Command | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` | **exit 0** — with `src/` deleted and `types: ["vite/client"]` removed |
| 2 | `npm test` | **159 pass / 0 fail** (12 suites) |
| 3 | `npm --prefix apps/web run lint` | **exit 0** |
| 4 | `npm --prefix apps/web run build` | **exit 0** — 12 routes prerendered |

Plus the repo-cleanliness gates: `git status` shows 35 deletions (`src/`, `index.html`,
`vite.config.ts`), the index is empty (nothing staged, so no `.next` / `node_modules` / `dist` can
be), and `rg -n "vite|src/App|react-router" AGENTS.md README.md` returns **zero hits**.

---

## 1. Deletions

`rm -rf src index.html vite.config.ts` — 35 files, all confirmed as ` D` in `git status`:

- `index.html`, `vite.config.ts`
- `src/` (33 files): `App.tsx`, `main.tsx`, `index.css`, `mockData.ts`, `types.ts`, `components/`
  (15), `lib/` (4: `apiFetch.ts`, `chartUtils.ts`, `timezones.ts`, `utils.ts`), `pages/` (2),
  `ui/` (2).

Untouched, as required: `packages/`, `scripts/`, `supabase/`, `neon.ts`, `hello.ts`, `.neon/`,
`metadata.json`, `apps/`.

## 2. `server.ts` — 2865 → 2848 lines (−17)

Five edits, each located by content. **Line-number drift resolved:** every target was in the
2820s, not the 2798s the brief cites. The brief's "comment on 2798" was the
`// Vite Middleware for development vs Static files in production` line above `startServer()`; the
guard's own comment block was kept verbatim per step 1's "keep it, comments and all".

| # | Before | After |
|---|---|---|
| 1 | `import path from 'path';`<br>`import { fileURLToPath } from 'url';` | both deleted |
| 2 | `const __filename = fileURLToPath(import.meta.url);`<br>`const __dirname = path.dirname(__filename);`<br>(+ the now-doubled blank line) | deleted, one blank line separator kept |
| 3 | `// Vite Middleware for development vs Static files in production` | `// Boots the API only. The web UI is a separate Next.js process (apps/web, :3001)`<br>`// that proxies /api/* here — see next.config.ts. Nothing in this process serves`<br>`// static files or an SPA fallback.` |
| 4 | 13-line `if (process.env.NODE_ENV !== 'production')` → `createViteServer`/`vite.middlewares` **else** `express.static(dist)` + `app.get('*')` catch-all | deleted entirely |

`startServer()` is now exactly `await initDb()` → the `/api/*` JSON-404 guard (untouched, still the
last middleware before `listen`) → `app.listen(PORT, '0.0.0.0', …)`. The boot log line
`RidgeLine server running on http://0.0.0.0:${PORT}` is byte-identical. `buildAllowedOrigins()`
(§4) was left alone. Nothing else in the file changed.

`req.path` in the guard and a prose "no-database path" comment are the only surviving `path`
tokens — no `path.*` call, no `__dirname`/`__filename`/`fileURLToPath` anywhere in the file.

## 3. `package.json`

**Scripts.** `build` (`vite build`), `preview`, `clean` deleted; `dev:web`, `start:web`,
`build:web` added as `npm --prefix apps/web run <script>`. The result matches the brief's script set
**exactly**.

**The `test` script was already identical to the brief and was not touched** — no diff to report:

```
"test": "node --import tsx --test \"packages/**/__tests__/*.test.ts\""
```

### Removed-deps accounting — 22 removed, 0 skipped

All 18 listed `dependencies` and all 4 listed `devDependencies` **did** exist in `package.json`, so
all 22 were removed. On the `cn` flag: **`cn` *was* present in `package.json` (`"cn": "^0.4.0"`)**, so
the "remove only deps that actually exist in package.json" rule says remove it — but nothing ever
imported it (it is not a module any code references; the `cn()` helper is a local function in
`apps/web/lib/utils.ts`). It was a bogus/typo entry and is now gone. **Nothing was skipped.**

- **dependencies −18:** `@base-ui/react`, `@fontsource-variable/geist`, `@radix-ui/react-slot`,
  `@tailwindcss/vite`, `@vitejs/plugin-react`, `class-variance-authority`, `clsx`, **`cn`**,
  `lucide-react`, `motion`, `react`, `react-dom`, `react-router-dom`, `recharts`, `shadcn`,
  `tailwind-merge`, `tw-animate-css`, `vite`
- **devDependencies −4:** `autoprefixer`, `tailwindcss`, `@types/react`, `@types/react-dom`

Every one of these is independently declared in `apps/web/package.json` where the web app still
needs it (`@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `lucide-react`, `react`,
`react-dom`, `recharts`, `tailwind-merge`, `tailwindcss`, `@types/react`, `@types/react-dom`,
`@tailwindcss/postcss`) — the two installs stay independent.

### Post-edit import scan (the brief's re-run)

```
server.ts, scripts/, packages/, neon.ts, hello.ts
  → @google/genai, @neondatabase/serverless, cookie-parser, crypto, dotenv,
    express, fs, node:assert/strict, node:test, path, twilio
```

- **Nothing kept is orphaned.** Remaining deps — `@google/genai`, `@neondatabase/serverless`,
  `cookie-parser`, `dotenv`, `express`, `jsonwebtoken`, `twilio` — each appear in that list.
  Remaining devDeps are all live: `@neon/config` (`neon.ts:1`), the four `@types/*` (typed imports),
  `tsx` (`dev`/`start`/`test`), `typescript` (`lint`).
- **Nothing removed is imported.** `rg "from '(vite|react|react-dom|react-router-dom|recharts|
  lucide-react|motion|shadcn|clsx|tailwind-merge|class-variance-authority|@radix-ui/react-slot|
  @base-ui/react|@vitejs/plugin-react|@tailwindcss/vite|@fontsource-variable/geist|
  tw-animate-css|cn)'"` over that same file set → **zero hits**.
- `path` and `fs` still appear in the scan as **Node builtins**, not packages — `path` only from
  `scripts/migrate.ts`, `fs` from `server.ts:5`. Neither needs a `package.json` entry. (`fs` was
  already an unused import before this task; the brief said "change nothing else", so I left it —
  see Concerns.)

### 🔒 Lockfile follow-up — REQUIRED, NOT DONE HERE

**No install was run at the repo root and `bun.lock` was not touched.** It still lists all 22
removed packages and is now inconsistent with `package.json`. The controller must run:

```bash
bun install        # updates bun.lock to match the pruned package.json
```

A plain `npm install` at the root is the documented drift trap (it would write a competing
`package-lock.json` next to the committed `bun.lock`). Note: root `package-lock.json` is currently
**tracked** and still holds the old dependency set — worth deciding in a follow-up whether it should
be removed now that `bun.lock` is the declared lockfile. `apps/web/package-lock.json` is untouched
and correct.

## 4. `tsconfig.json`

- Deleted `"types": ["vite/client"]` (was line 7). Confirmed necessary: with `vite` gone this key
  makes *every* root typecheck fail with `Cannot find type definition file for 'vite/client'`.
- Deleted the `"paths": { "@/*": ["./*"] }` block (was lines 19-22) — **guarded by a repo-wide scan
  first**: `rg "from '@/|require\('@/|import\('@/"` across the whole repo (including `apps/web`,
  excluding `node_modules`) returned **zero matches**, so nothing depended on it. `apps/web` keeps
  its own `paths` mapping in its own `tsconfig.json`.
- Everything else kept: `allowImportingTsExtensions` (still satisfied by the `noEmit: true` beside
  it), `skipLibCheck`, `jsx`, `moduleResolution`, `lib`, and the rest. 27 → 21 lines.

## 5. `AGENTS.md` — rewritten in place, not appended

Rewrote **Commands** and **Architecture** wholesale; corrected the rest. New topology facts added
as the brief requires: two processes/two ports, `rewrites()` proxies **only** `/api/:path*`,
webhooks deliberately **not** proxied, cookies are per-host so `ridgeline_session` crosses the
rewrite unchanged, and production is a host-level path split. Deleted: the "hardcoded PORT 3000 and
mounts Vite in middlewareMode" bullet, `npm run build`/`preview`/`clean`, the `DISABLE_HMR` bullet
(its `vite.config.ts` referent is gone), the `ERESOLVE`/`esbuild` bullet, the whole `src/` paragraph,
and the hybrid-`activeTab` routing bullet. The `--legacy-peer-deps` note and the "no ESLint/Prettier/
CI" note were kept per the brief — the former re-justified to the still-true lockfile-drift reason
rather than the removed bundler's peer conflict.

The deployment paragraph is now the two-process requirement (`npm start` + `npm run start:web`; a
Next-only host serves the shell and 404s every `/api/*`), replacing the "static-only host" warning.

### Documentation-vs-code drift found, and how I wrote it

Verified against `server.ts` rather than trusting the old text:

1. **`/api/neon/execute-sql` and `/api/ai/test-endpoint` no longer exist.** `rg` finds only a
   comment at `server.ts:2225` referring to the SSRF primitive test-endpoint "used to" expose. The
   old bullet that told the next agent not to expose them is **replaced** with one that says both are
   gone, the surface was closed, and points at the real unauthenticated list — plus a warning that
   there is no longer a safe precedent to copy when adding a debug route.
2. **The unauthenticated-endpoint list was wrong in four ways.** `/api/sms/process` and
   `/api/missed-call/process` are **no longer public** — both are `requireAuth` +
   `requirePermission('assistant.run')` + per-org `rateLimitPerOrg` (`server.ts:2199`, `server.ts:2545`).
   Removed from the list. Missing from the list and now added: `/api/health`,
   `/api/neon/test-function`, and `/api/auth/me` (which does its own cookie/Bearer check and answers
   `{ user: null }` rather than 401).
3. **The "secret landmine" bullet was false and pointed at a deleted file.** It claimed a live `sk-…`
   key hardcoded at `server.ts:129` *and again* in `src/mockData.ts:56`. Reality:
   `DEFAULT_OPENAI_API_KEY` is env-only (`packages/application/ai-pipeline.ts:30`), and
   `apps/web/mockData.ts:56` ships `openaiApiKey: ''`. `rg "sk-"` finds matches **only** in test
   fixtures (`sk-test-key`). Rewrote the bullet to state the current state, re-pointed at
   `apps/web/mockData.ts`, and made it an instruction to re-verify rather than trust the doc.
4. **`PORT` was documented as hardcoded and not env-configurable.** Code honours `process.env.PORT`
   with a 3000 fallback (`server.ts:53-55`). Corrected.
5. **Stale line refs corrected** in the sections I touched: `runSmsAssistant()` → 
   `packages/application/ai-pipeline.ts:144` (not `server.ts:2018` — it moved to `packages/`),
   `runTenantQuery()` → `packages/application/tenant-context.ts:11` (not `server.ts:365`),
   `toUuid()` → `packages/application/id-utils.ts:22` (not `server.ts:283`), `initDb()` →
   `server.ts:2639-2816`, `startServer()` → `server.ts:2821-2846`.
6. The "README's project tree is stale" drift bullet was **re-pointed** at what the tree still omits
   (`scripts/`, `packages/`, `neon.ts`, `hello.ts`, `.neon/`) now that the `src/` half is fixed.
7. `DataProvider.tsx` is now named as the cross-view data context (verified: it seeds from
   `mockData.ts` then overwrites from `/api/neon/data` via `apiFetch`).

## 6. `README.md` — four sections, Environment Configuration untouched

- **System Architecture** — split into *Express (:3000, API + webhooks)* and *Next.js App Router
  (:3001, UI)* with the host reverse proxy between them, plus a note that webhooks bypass the
  rewrite. "React 19 Frontend (Vite)" is gone; the view boxes are re-labelled as real routes.
  Closing line added: Express emits no HTML, the only frontend-shaped response it can produce is the
  JSON 404.
- **Project Structure** — `src/` + `index.html` blocks replaced with the actual `apps/web/` tree
  (verified file-by-file against `find`; I initially wrote a `ServiceCatalog.tsx` that does not
  exist in `apps/web` and removed it), plus `packages/`, `scripts/`, and `bun.lock`, with root
  `server.ts` marked "API (:3000) — routes, AI pipeline, Neon. No UI."
- **Installation & Run** — both installs, both processes in two terminals, open **:3001**, and a
  plain statement that the browser only ever talks to :3001 because the rewrite proxies `/api/*`
  (and that `/webhooks/*` is not proxied).
- **Build for Production** — `build:web` + `npm --prefix apps/web run start` + `npm start`, with the
  host path-split requirement (Twilio signature validation needs Express on its real host).
- **Environment Configuration block left byte-for-byte unchanged.** No credential was added,
  removed, or referenced anywhere in either doc.

---

## Concerns / follow-ups (none block the sprint's exit condition)

1. **`bun.lock` is stale — run `bun install` before deploying.** Root `package-lock.json` is tracked
   and also still lists the removed packages.
2. **Three stale comments in `server.ts` name now-deleted files** — `server.ts:2194`
   (`src/App.tsx handleProcessCustomerSms`), `server.ts:2541` (`the Vite SettingsView`), and
   `server.ts:2826-2828`, the JSON-404 guard's comment, which explains the guard in terms of the
   removed Vite middleware and `index.html` catch-all. I kept all three verbatim because the brief
   says "change nothing else" and explicitly says keep the guard's comment. They are comments only —
   no behaviour — but they are exactly the stale-instruction class this task exists to remove, so
   they deserve a one-line follow-up.
3. **`server.ts:5` imports `fs` and never uses it** (pre-existing; `rg "\bfs\b"` finds one hit, the
   import itself). Left alone per "change nothing else". Trivial to drop.
4. **Root `tsc` typechecks `apps/web/**` too** (566 files) because root `tsconfig.json` has no
   `include`/`files`. It resolves React/Next/etc. from `apps/web/node_modules`, so removing them
   from root is safe — **but only while that second install exists.** A fresh clone that runs
   `bun install` without `npm install --prefix apps/web` will fail root `npx tsc --noEmit` with
   unresolved React imports. This is inherent to the no-`include` tsconfig, not introduced here;
   worth an `exclude: ["apps/web"]` in a later task.
5. **A stale `dist/` remains** in the working tree (gitignored, and no longer served since
   `express.static` is gone). Harmless; delete whenever.
6. **For Probe (runtime, not run here):** with `src/` gone, `curl -s http://localhost:3000/` must
   return Express's own 404 and `curl -s http://localhost:3000/api/health` must still return JSON;
   `curl -s http://localhost:3001/api/neon/status` must still return JSON through the rewrite. The
   `/api/*` JSON-404 guard is now the *only* middleware before `listen`, so an unknown `/api/*`
   path is the sole path that can reach it — worth one negative-path check
   (`curl -s http://localhost:3001/api/does-not-exist` → JSON 404, not HTML).
7. **For Sentinel:** the CSRF `buildAllowedOrigins()` dev seed (`server.ts:180-190`) is unchanged
   and is what lets the :3001 proxy through the guard; it is `NODE_ENV !== 'production'` only, so
   production stays env-driven. No new unauthenticated route was added, and the unauthenticated
   surface actually shrank by two routes.
