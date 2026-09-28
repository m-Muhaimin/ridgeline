# Task 1 — Create `apps/web` + configure Next.js App Router

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §2.1, §2.4, §3 row 1. Decisions are already made — do not revisit.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is **self-contained**: own `package.json` / `tsconfig.json` / `next.config.ts` / `node_modules`. **No npm workspaces.** Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9 (task 10 owns those).
2. Every `apps/web` API call goes through `apiFetch` with **relative** paths (`/api/...`) and `credentials: 'include'`. Never an absolute API base URL; never bare `fetch(...).json()` (the one allowed exception is Task 1's `/health` page, which runs before `lib/` exists).
3. Ported code is a **move, not a redesign**: class names, copy, layout, prop shapes, and internal state logic are copied verbatim from `src/`. No styling changes, no new dependencies, no API changes.
4. No `'use client'` directive inside `apps/web/components/**` or `apps/web/lib/**` — the client boundary is the page/layout. No Server Components for data.
5. Gate at every task: `npx tsc --noEmit` + `npm test` (159 pass) + `npm --prefix apps/web run lint` all green. `npm --prefix apps/web run build` additionally at tasks 1, 3, 10.
6. Use **relative imports** (`../types`, `../lib/utils`) exactly as `src/` does. Do not add or use a `@/` alias in ported code.

## Goal
Stand up a Next.js App Router app in `apps/web` that proxies `/api/*` to Express on :3000, carries the existing Tailwind v4 theme + fonts + metadata, and proves the proxy chain with a `/health` page. Plus the one `server.ts` change that the proxy requires (dev-origin allowlist).

## Files
- **Create** `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/postcss.config.mjs`, `apps/web/.gitignore`
- **Create** `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/health/page.tsx`
- **Edit** `server.ts` — `buildAllowedOrigins()` only (lines 181–189)
- **Do not create yet**: `lib/`, `types.ts`, `components/`, `app/(auth)/`, `app/(dashboard)/` — tasks 2 and 3 own those.

## `apps/web/package.json` (write exactly; then pin `next` — see below)
```json
{
  "name": "ridgeline-web",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@radix-ui/react-slot": "^1.3.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.546.0",
    "next": "16.3.6",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^3.10.1",
    "tailwind-merge": "^3.7.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.3.3",
    "@types/node": "^22.14.0",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "tailwindcss": "^4.3.3",
    "typescript": "^5.9.3"
  }
}
```
- This is the **whole-sprint** dependency set — one install, no lockfile churn in later tasks. Versions mirror root `package.json` (lucide stays on the root's `0.x` major so the icon set is identical; charts/lucide/cva/tw-merge must not drift).
- `typescript` is pinned to `^5.9.3` **not** the root's `^7.0.2`: Next 16 is type-checked against TS 5, and apps/web must be isolated from the root toolchain.
- **Pin `next` exactly** after install: run `npm install --legacy-peer-deps` in `apps/web`, then read `node -p "require('./node_modules/next/package.json').version"` and write that exact version (no `^`) into `package.json`. If the resolved version cannot install cleanly against React 19 + Tailwind 4, fall back **one major** (`npm install next@15`) and say so in your report.

## `apps/web/next.config.ts` (write exactly)
```ts
import type { NextConfig } from 'next';

const API_ORIGIN = 'http://localhost:3000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Only /api/* is proxied. /webhooks/* is deliberately NOT proxied: in dev
  // Twilio never talks to :3001, and in production the host routes webhooks
  // straight to Express (PLAN §2.2).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
```

## `apps/web/tsconfig.json` (write exactly)
Next's default shape, with **two deliberate pins**: `"strict": false` (the root tsconfig has no `strict`; keeping it off makes the port a pure move and avoids a second, orthogonal migration) and `"plugins": [{ "name": "next" }]`. Keep `"skipLibCheck": true`, `"jsx": "preserve"`, `"moduleResolution": "bundler"`, `"noEmit": true`, `"allowJs": true`, `"isolatedModules": true`, `"esModuleInterop": true`, `"resolveJsonModule": true`, `"target": "ES2022"`, `"lib": ["dom","dom.iterable","esnext"]`, `"incremental": true`, `"baseUrl": "."`, `"paths": { "@/*": ["./*"] }` (unused — ported code uses relative imports).
`next-env.d.ts` is **generated** by Next; do not hand-write it. Run `npm run dev` (or `next build`) once before `npm run lint`, or `tsc` will miss Next's ambient types.

## `apps/web/postcss.config.mjs`
```js
const config = { plugins: { '@tailwindcss/postcss': {} } };
export default config;
```

## `apps/web/.gitignore`
```
.next/
node_modules/
out/
```
(root `.gitignore` has no `.next/` — this file is required or build output gets committed.)

## `apps/web/app/globals.css`
Verbatim copy of `src/index.css` (25 lines): `@import "tailwindcss";`, the `@theme` block (`--font-head` Bricolage Grotesque, `--font-mono` IBM Plex Mono, `--font-sans` IBM Plex Sans), `body`, `.font-head`, `.font-mono`, `.count-up`. Do **not** add `@import "tw-animate-css"` — root never imports it either, so `animate-in`/`fade-in`/`slide-in-from-bottom-2` are inert today; importing it would silently change motion across every component.

## `apps/web/app/layout.tsx` (root layout — server component, no data fetching)
```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RidgeLine - AI Scheduling & Dispatch Assistant',
  description: 'AI-powered scheduling and dispatch assistant for solo tradespeople. Runs booking conversations over SMS, auto-confirms jobs, parses natural-language reschedules, and converts missed calls into revenue.',
  openGraph: {
    title: 'RidgeLine - AI Scheduling & Dispatch Assistant',
    description: 'AI-powered scheduling and dispatch assistant for solo tradespeople. Runs booking conversations over SMS, auto-confirms jobs, parses natural-language reschedules, and converts missed calls into revenue.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};
```
`<html lang="en">` + `<head>` with the three Google Fonts tags copied verbatim from `index.html:12-14` (two `preconnect` — the second with `crossOrigin="anonymous"` — then the `css2?family=Bricolage+Grotesque...` stylesheet). `<body className="bg-neutral-50 text-neutral-900 antialiased selection:bg-neutral-900 selection:text-white font-sans">` (from `index.html:16`, plus `font-sans` so the Tailwind theme font applies). `{children}` inside.

## `apps/web/app/health/page.tsx` — the proxy proof
`'use client'`. On mount, `fetch('/api/neon/status', { credentials: 'include' })`, `await res.text()`, then either `JSON.parse` (render `<pre>{JSON.stringify(status, null, 2)}</pre>`) or render `HTTP <status> — <first 200 chars of body>`. Track a `cancelled` flag in the effect cleanup. Render three states: loading (`…`), error, success. Neutral classes only (`text-sm font-mono text-neutral-700`, `p-4`).
It deliberately uses **bare `fetch`**: `lib/apiFetch` is task 2's deliverable and must not be created here.

## `server.ts` edit — `buildAllowedOrigins()` (lines 181–189)
Replace the body of the `return [...set];` step with:
```ts
  const set = new Set<string>([...fromEnv, ...(appUrl ? [appUrl] : [])]);
  // Two-process dev: the Next app runs on :3001 and proxies /api/* here, so a
  // proxied POST arrives with Host: localhost:3000 but Origin:
  // http://localhost:3001. Seed both dev origins so the CSRF guard does not
  // reject our own frontend. Production stays strictly env-driven.
  if (process.env.NODE_ENV !== 'production') {
    set.add('http://localhost:3000');
    set.add('http://localhost:3001');
  }
  return [...set];
```
Change nothing else in `server.ts`. The Vite middleware and `dist/` serving stay until task 10.

## Verification
```bash
npm install --legacy-peer-deps --prefix apps/web     # then pin next's exact version
npx tsc --noEmit                                    # root, must stay clean
npm test                                             # 159 pass
npm --prefix apps/web run build                      # first run generates next-env.d.ts
npm --prefix apps/web run lint                       # apps/web tsc --noEmit
```
Runtime, with BOTH processes up (root `npm run dev` on :3000, `npm --prefix apps/web run dev` on :3001):
- `curl -s http://localhost:3001/api/neon/status` → JSON (proves the rewrite reaches Express)
- `curl -s -i http://localhost:3001/api/neon/nope` → **404 JSON**, not `index.html` (Express's `/api` 404 guard survives the proxy)
- `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/api/auth/login -H "Content-Type: application/json" -H "Origin: http://localhost:3001" -d '{}'` → **not 403** (origin guard accepts the seeded origin)
- Browser: `http://localhost:3001/health` shows the status JSON; `http://localhost:3001/` still serves the **Vite** app from :3000-era? No — after this task `/` is a Next 404. Confirm `http://localhost:3000` still serves the Vite frontend unchanged (Vite removal is task 10).

## Non-goals
No `lib/`, `types.ts`, `mockData.ts`, `components/`, or `(auth)`/`(dashboard)` routes. No Vite removal. No `build`/`preview` script change at root. No lockfile write at the repo root.

## Where it fits
Task 1 is the seam: it makes the proxy, theme, and dev origin work. Tasks 2–9 all assume `apps/web` boots on :3001 with the API reachable at relative `/api/...`.
