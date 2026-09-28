# Task 10 — Remove the Vite frontend; make Next the web app

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §2.2, §2.5, §3 row 10. This is the sprint's exit condition: **Next.js owns the web application, Express remains the backend API.**

## Global constraints
This is the only task that may touch root `package.json`, `bun.lock` and `tsconfig.json`. Everything else in the sprint stays as established: no API changes, no styling changes, no new endpoints.

## Goal
Delete the Vite app, strip Express's frontend serving, drop the root frontend dependencies, and rewrite the docs for the two-process topology.

## Files
- **Delete** `src/` (whole tree), `index.html`, `vite.config.ts`
- **Edit** `server.ts` — `startServer()` only (lines 2798-2838) plus four now-dead lines at the top
- **Edit** `package.json` — scripts + dependencies
- **Edit** `tsconfig.json` — two dead keys
- **Edit** `AGENTS.md`, `README.md`
- **Do not delete** `packages/` (server + tests use it), `scripts/`, `supabase/`, `neon.ts`, `hello.ts`, `.neon/`, `metadata.json`, `apps/web/`

## `server.ts` edits
1. Delete the block at 2821-2833 and the comment on 2798 — the `if (process.env.NODE_ENV !== 'production')` Vite `createServer` branch, the `express.static(path.resolve(__dirname, 'dist'))` branch, and the `app.get('*', …)` SPA fallback. `startServer()` becomes: `await initDb()` → the `/api/*` JSON-404 guard (keep it, comments and all — it is the last middleware before `listen`) → `app.listen(PORT, '0.0.0.0', …)`.
2. Delete lines 3, 54, 55: `import { fileURLToPath } from 'url';`, `const __filename = fileURLToPath(import.meta.url);`, `const __dirname = path.dirname(__filename);`.
3. Delete `import path from 'path';` (line 2) — verified: those two `path.*` call sites are the only ones in the file.
4. Change nothing else. The `buildAllowedOrigins()` dev seed from task 1 stays (it is what lets the :3001 proxy through the CSRF guard).
5. Confirm the boot log line is unchanged: `RidgeLine server running on http://0.0.0.0:3000`.

## `package.json` edits
Scripts — final set:
```json
"scripts": {
  "dev": "tsx server.ts",
  "start": "tsx server.ts",
  "dev:web": "npm --prefix apps/web run dev",
  "start:web": "npm --prefix apps/web run start",
  "build:web": "npm --prefix apps/web run build",
  "lint": "tsc --noEmit",
  "test": "node --import tsx --test \"packages/**/__tests__/*.test.ts\""
}
```
(`build`, `preview`, `clean` are deleted — all three were Vite-only.)

**Remove** these `dependencies` (frontend-only; verified by `rg -o "from '([^']+)'" server.ts scripts/*.ts neon.ts hello.ts` which resolves only to `express, path, url, fs, crypto, dotenv, cookie-parser, jsonwebtoken, twilio, @google/genai, @neondatabase/serverless` + `./packages/**`): `@base-ui/react`, `@fontsource-variable/geist`, `@radix-ui/react-slot`, `@tailwindcss/vite`, `@vitejs/plugin-react`, `class-variance-authority`, `clsx`, `cn`, `lucide-react`, `motion`, `react`, `react-dom`, `react-router-dom`, `recharts`, `shadcn`, `tailwind-merge`, `tw-animate-css`, `vite`.
**Remove** these `devDependencies`: `autoprefixer`, `tailwindcss`, `@types/react`, `@types/react-dom`.
**Keep** everything else. After editing, re-run that import scan and confirm nothing you kept is orphaned and nothing you removed is imported.
**Do not run an install at the repo root** — plain `npm install` would write a `package-lock.json` next to the committed `bun.lock` (the documented drift trap). Report `bun install` as the required follow-up for the lockfile.

## `tsconfig.json` edits
Delete `"types": ["vite/client"]` (line 7) — with `vite` gone this becomes `Cannot find type definition file for 'vite/client'` and **every** root typecheck fails. Deleting the key restores the default "all `@types` packages" behavior, which keeps the Node globals `server.ts` uses resolving. Also delete the `"paths": { "@/*": ["./*"] }` block (lines 19-22) — no file in the repo uses an `@/` import. Change nothing else: `allowImportingTsExtensions` stays (it requires the `noEmit: true` that is already there), `skipLibCheck`, `jsx`, `moduleResolution` all stay.

## `AGENTS.md` edits (rewrite these sections, don't append a changelog)
- **Commands** — two processes: `npm run dev` (Express API only, :3000) and `npm run dev:web` (Next, :3001). Delete every Vite mention: the "hardcoded PORT 3000 and mounts Vite in middlewareMode" bullet, `npm run build` → `vite build`, `npm run preview`, `npm run clean`. Keep the `npm install --legacy-peer-deps` note and the "no test runner / `tsc --noEmit` is the whole verification story" note (the 159-test node runner is still real).
- **Architecture** — the tree: `apps/web/` is the frontend; `server.ts` is the API. Delete "`server.ts` serves the UI *and* the API" and the whole `src/` paragraph (`src/App.tsx`, `src/components/`, `src/lib/`, `src/types.ts`, hybrid `activeTab` routing, `apiFetch` — all gone; those files now live under `apps/web/`).
- Add the new topology facts: `next.config.ts` `rewrites()` proxies **only** `/api/:path*` → `http://localhost:3000/api/:path*`; webhooks are **not** proxied; cookies are per-host so `ridgeline_session` flows through the rewrite unchanged; production is host-level path-split (`/api/*` + `/webhooks/*` → Express, everything else → Next).
- Keep the "silent-fallback trap" and "known drift" sections, but delete their Vite/`index.html`/`src/` specifics and re-point them at `apps/web/`.
- Fix the deployment paragraph: replace the "static-only host" warning with the two-process requirement (`npm start` + `npm run start:web`; a Next-only host gets the app shell and 404s every `/api/*`).
- `AGENTS.md` is itself a source of truth for the next agent — leaving Vite instructions in it is the bug this task exists to prevent.

## `README.md` edits
- **System Architecture** (63-94): split the diagram into *Twilio → Express (:3000, API + webhooks)* and *Next.js App Router (:3001, UI)* with the host reverse proxy between them. Drop "React 19 Frontend (Vite)"; keep the component-ish boxes, re-labelled as Next routes (`/`, `/dispatch`, `/sms`, `/missed-calls`, `/customers`, `/services`, `/settings`).
- **Project Structure** (98-132): replace the `src/` + `index.html` blocks with `apps/web/` (app routes, components, lib, types.ts) and note that root `server.ts` is API-only.
- **Installation & Run** (163-171): `npm install --legacy-peer-deps`, then `npm run dev` **and** `npm run dev:web` in a second terminal; open `http://localhost:3001` (not :3000). State plainly that the browser only ever talks to :3001 and `/api/*` is proxied.
- **Build for Production** (173-177): `npm run build:web` + `npm --prefix apps/web run start`, plus `npm start` for the API; note the host path-split requirement.
- Do not touch the Environment Configuration block's contents in this task (the published-credentials drift is a separate fix) — but do not add any new credentials anywhere.

## Verification
```bash
npx tsc --noEmit          # must stay 0 errors with src/ gone and vite/client removed
npm test                   # 159 pass
npm --prefix apps/web run lint
npm --prefix apps/web run build     # required gate
```
Runtime, both processes:
- `npm run dev` → boot log shows only `RidgeLine server running on http://0.0.0.0:3000`; **no** Vite middleware, no `dist/` served. `curl -s http://localhost:3000/api/health` returns JSON; `curl -s http://localhost:3000/` returns Express's 404 (no more `index.html`).
- `curl -s http://localhost:3001/api/neon/status` → JSON (proxy still works with `src/` deleted).
- `npm run dev:web` → `http://localhost:3001` loads the dashboard shell; log in with the demo account; walk `/`, `/dispatch`, `/sms`, `/missed-calls`, `/customers`, `/services`, `/settings?tab=ai_dispatcher`; confirm mutations (send a message, change a booking status, save settings) and the sign-out cookie round-trip.
- `git status` — confirm no `apps/web/.next/`, `apps/web/node_modules/`, or `dist/` is staged, and that `src/`, `index.html`, `vite.config.ts` show as deletions.
- `rg -n "vite|src/App|react-router" AGENTS.md README.md` → zero hits for stale instructions.

## Non-goals
No new features, no deployment config (no `vercel.json`/`Dockerfile` — Sprint 7), no credential cleanup, no RSC-ification (Sprint 5), no database change, no `packages/` change.

## Where it fits
Last task of Sprint 4. When it lands, PLAN's exit condition holds and the duplication between `src/` and `apps/web/` is gone.
