# Task 2 — Port shared lib + auth UI into `apps/web` — Report

**Status:** ✅ complete. All gates green. Not committed (no commit was requested).

---

## 1. Files created (13 new, 0 modified)

All under `apps/web/`. Every file below is new; nothing in the root repo was modified.

| New file | Source | Copy fidelity |
|---|---|---|
| `apps/web/types.ts` | `src/types.ts` | verbatim **+ 1 appended line** (`SettingsSubTab`) — diff is `149a150,151` |
| `apps/web/mockData.ts` | `src/mockData.ts` (780 lines) | **byte-identical** (`diff -q` clean) |
| `apps/web/lib/apiFetch.ts` | `src/lib/apiFetch.ts` (63 lines) | **byte-identical** — nothing added |
| `apps/web/lib/utils.ts` | `src/lib/utils.ts` | **byte-identical** |
| `apps/web/lib/timezones.ts` | `src/lib/timezones.ts` | **byte-identical** |
| `apps/web/lib/chartUtils.ts` | `src/lib/chartUtils.ts` | **byte-identical** |
| `apps/web/lib/triage.ts` | `packages/domain/safety/triage.ts` | **byte-identical** |
| `apps/web/components/OnboardingPage.tsx` | `src/pages/OnboardingPage.tsx` (569 lines) | verbatim **except 2 import paths** (diff below) |
| `apps/web/components/AuthPage.tsx` | `src/pages/AuthPage.tsx` (291 lines) | ported per §"AuthPage port rules" — deltas in §2 |
| `apps/web/components/RidgeLineLogo.tsx` | `src/components/RidgeLineLogo.tsx` | **byte-identical** — *see deviation D1* |
| `apps/web/components/AIIcon.tsx` | `src/components/AIIcon.tsx` | **byte-identical** — *see deviation D1* |
| `apps/web/app/(auth)/auth/page.tsx` | new (brief §auth route) | brief snippet **+ 1 corrected path** — *see deviation D2* |
| `apps/web/app/(auth)/onboarding/page.tsx` | new (brief lines 71-77) | as specified |

**Not ported (per brief):** `src/components/OnboardingWizard.tsx` (nothing imports it; task 10 deletes it).
**No `next build` run** (explicitly not required this task).

Fidelity proof (`diff -q` / `diff`, verbatim output):
```
IDENTICAL  src/lib/apiFetch.ts -> apps/web/lib/apiFetch.ts
IDENTICAL  src/lib/utils.ts -> apps/web/lib/utils.ts
IDENTICAL  src/lib/timezones.ts -> apps/web/lib/timezones.ts
IDENTICAL  src/lib/chartUtils.ts -> apps/web/lib/chartUtils.ts
IDENTICAL  packages/domain/safety/triage.ts -> apps/web/lib/triage.ts
IDENTICAL  src/mockData.ts -> apps/web/mockData.ts
IDENTICAL  src/components/RidgeLineLogo.tsx -> apps/web/components/RidgeLineLogo.tsx
IDENTICAL  src/components/AIIcon.tsx -> apps/web/components/AIIcon.tsx

=== types.ts diff (expect only the appended SettingsSubTab) ===
149a150,151
> export type SettingsSubTab = 'general' | 'rates' | 'ai_dispatcher' | 'billing';
>

=== OnboardingPage diff (expect only the two icon import lines) ===
16,17c16,17
< import { RidgeLineLogo } from '../components/RidgeLineLogo';
< import { AIIcon } from '../components/AIIcon';
---
> import { RidgeLineLogo } from './RidgeLineLogo';
> import { AIIcon } from './AIIcon';
```

The appended `SettingsSubTab` is the only definition of that type in `apps/web`. In root
`src/` it still lives in `src/components/OrganizationSettings.tsx` (`App.tsx:13` imports it
from there) — the brief places it in `types.ts` in `apps/web` because task 3 and task 9 both
need it and it cannot live in either one's file. No duplication was introduced.

---

## 2. Port deltas

### `components/AuthPage.tsx` — prop surgery + local toast (brief §"AuthPage port rules")

| Original (`src/pages/AuthPage.tsx`) | Ported (`apps/web/components/AuthPage.tsx`) |
|---|---|
| `interface AuthPageProps { onAuthSuccess, showToast, currentUser? }` | **removed entirely** — `export const AuthPage: React.FC = ()` (no props) |
| `const navigate = useNavigate(); const location = useLocation();` (react-router-dom) | `const router = useRouter(); const searchParams = useSearchParams();` (`next/navigation`) |
| `new URLSearchParams(location.search)` | `useSearchParams()` |
| `React.useEffect(() => { if (currentUser) navigate('/', { replace: true }) }, …)` | **deleted** (the `(dashboard)` layout owns that guard) |
| `showToast` prop from `App.tsx` | `const [toastMessage, setToastMessage] = useState<string \| null>(null)` + local `showToast(msg)` that sets it and clears via `setTimeout(…, 4000)` |
| — | new `<CheckCircle2>` import + the `App.tsx:596-601` toast markup rendered as the card's first child (`fixed bottom-4 right-4 z-50 … border border-neutral-700 animate-in fade-in slide-in-from-bottom-2`, `text-emerald-400` icon, `<span>{toastMessage}</span>`) — byte-identical to `App.tsx` |
| `navigate('/')` (×3: brand logo, back button, ×2 after auth) | `router.push('/')` |
| `onAuthSuccess(data.user); navigate('/');` (×2) | `router.push(data.user.onboardingCompleted ? '/' : '/onboarding');` — *see note below* |

Everything else — all Tailwind classes, the login/register tab toggle, the `?mode=` initial
tab, the register fields (`Full Name / Owner Name`, `Trade Specialization` + 5 options), the
password reveal toggle, the `Error:` alert, and the **one-click demo login** button
(`handleQuickDemo` still posts `mark@apexplumbingpro.com` / `Password123!` byte-for-byte,
still `credentials: 'include'`) — is copied verbatim.

> **Why the double-push collapsed to one push.** The source ends each auth handler with
> `onAuthSuccess(data.user); navigate('/');`. In `App.tsx` that second `navigate('/')` is
> harmless because `ProtectedRoute` immediately redirects to `/onboarding` when
> `!user.onboardingCompleted`. `apps/web` has no `ProtectedRoute` on these routes, so
> keeping the trailing `router.push('/')` would send a **newly registered** user to `/`
> (Next 404, the task-3 shell) instead of `/onboarding`, breaking the brief's own gate
> "Register tab: creates an account and lands on `/onboarding`". The brief's rule
> "replace `onAuthSuccess(user)` with the local tail of the same function
> (`router.push(user.onboardingCompleted ? '/' : '/onboarding')`)" describes the sole
> navigation, so that is what ships. This is the *only* behavioral difference from the
> source in the two auth handlers, and it makes `apps/web` match the source's **net**
> observed behavior rather than its literal line count.

### `components/OnboardingPage.tsx`
Props **unchanged** (`user`, `onComplete`, `showToast`). `defaultServicesByTrade`, the 4
steps, and `handleFinishOnboarding` → `apiFetch('/api/auth/complete-onboarding', …)` with
`credentials: 'include'` are untouched. Only the two sibling-icon import paths changed
(`../components/X` → `./X`) because the file now lives in `apps/web/components/` itself.
No router hook was added.

### `app/(auth)/onboarding/page.tsx` (owns its session check, brief lines 71-77)
- `'use client'`; `useEffect` on mount → `apiFetch('/api/auth/me')`; `user: User | null` + `loading: boolean`.
- `loading` → the exact `App.tsx:52-59` spinner (`min-h-screen flex items-center justify-center bg-neutral-50` + `flex flex-col items-center gap-4` + `h-8 w-8 border-4 border-neutral-200 border-t-neutral-900 rounded-full animate-spin` + "Securing your session...").
- `!user` and not loading → `router.replace('/auth')` in a second `useEffect`, render `null`.
- `user` → `<OnboardingPage user={user} onComplete={handleComplete} showToast={showToast} />` with the same local-toast pattern as `AuthPage` (same markup, 4000 ms clear).
- `handleComplete(org, _settings, _services)` = success toast `` `Setup complete! Dispatch engine online for ${org.name}.` `` + `router.push('/')` + `router.refresh()`. The `App.tsx` `DataProvider` state writes (setCurrentOrg / setOrganizations / setSettings / setServices / setCurrentUser) are **not** reproduced — there is no provider on this route, and the route has no data to seed in task 2. The two unused params are underscore-prefixed so `noUnusedParameters` would not bite later.
- **No `onboardingCompleted` early redirect** — the wizard stays re-runnable, matching the sidebar "Launch Onboarding Wizard" behavior (brief line 77).

### Global constraints audit
| # | Constraint | Evidence |
|---|---|---|
| 1 | No root `package.json` / `bun.lock` / `tsconfig.json` edits | `git status` shows only `server.ts` + the migration (controller's fix) modified; all my changes are inside untracked `apps/` |
| 2 | All API calls via `apiFetch`, relative paths, `credentials: 'include'` | `rg "API_BASE\|baseUrl:\|http://localhost:3000" apps/web/lib apps/web/components "apps/web/app/(auth)"` → `clean: none` |
| 3 | Move, not a redesign | §1 diff proof; every class/copy string preserved; no new deps (all of `clsx`, `tailwind-merge`, `lucide-react`, `recharts` were already in `apps/web/package.json` from task 1) |
| 4 | No `'use client'` in `components/**` or `lib/**`; page is the boundary | `rg -l "use client" apps/web/components apps/web/lib` → `clean: none`; only the two route pages carry it |
| 5 | Gate: root tsc + `npm test` (159) + `apps/web` lint; no `next build` | §3; `next build` intentionally not run |
| 6 | Relative imports only, no `@/` | `rg "from '@/"` across all ported files → `clean: none` |

---

## 3. Verification output (verbatim)

### 3.1 Static gates
```
=== root: npx tsc --noEmit ===
tsc exit=0
```
```
=== root: npm test ===
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2039.3315
npm test exit=0
```
```
=== apps/web: npm run lint ===
> ridgeline-web@0.0.0 lint
> tsc --noEmit
lint exit=0
```
`npx tsc --noEmit` was re-run after server teardown: `exit=0`.

### 3.2 Servers (root `npm run dev` on :3000, `npm --prefix apps/web run dev` on :3001)
```
Neon Lakebase Postgres pool initialized
Database tables, tenant-scoped RLS policies, and application role initialized successfully.
RidgeLine server running on http://0.0.0.0:3000
```
```
▲ Next.js 16.3.6 (Turbopack)
- Local:         http://localhost:3001
✓ Ready in 1915ms
✓ Running next.config.ts took 244ms
```

### 3.3 Proxy gate
```
=== GATE 1: GET /api/auth/me through the :3001 proxy ===
HTTP/1.1 200 OK
x-powered-by: Express
content-type: application/json; charset=utf-8
content-length: 28
Vary: Accept-Encoding

{"success":true,"user":null}
```

### 3.4 `/auth` route serves 200 HTML at :3001
```
http_code=200 content_type=text/html; charset=utf-8 size=22127
--- /auth HTML sanity markers ---
Encrypted Contractor Account
One-Click Demo Login (Mark Kowalski)
Sign in to RidgeLine
--- fonts link + font-head class present? ---
1
1
```
(`Bricolage+Grotesque` font link present; `class="text-2xl font-bold text-neutral-900 font-head"` on the heading.)

### 3.5 Full cookie round trip through the :3001 proxy
```
=== GATE 3a: POST /api/auth/login VIA :3001 ===
HTTP/1.1 200 OK
x-powered-by: Express
set-cookie: ridgeline_session=<jwt>; Max-Age=604800; Path=/; Expires=Mon, 05 Oct 2026 06:38:29 GMT; HttpOnly; SameSite=Lax
content-type: application/json; charset=utf-8
content-length: 573

{"success":true,"token":"<jwt>","user":{"id":"<uuid>","email":"mark@apexplumbingpro.com","fullName":"Mark Kowalski","role":"owner","organizationId":"<uuid>","onboardingCompleted":true}}
```
```
=== GATE 3b: GET /api/auth/me WITH the cookie (through :3001) ===
{"success":true,"user":{"id":"<uuid>","email":"mark@apexplumbingpro.com","fullName":"Mark Kowalski","role":"owner","organizationId":"<uuid>","onboardingCompleted":true}}
```
```
=== GATE 3c: GET /api/neon/data WITH the cookie (through :3001) ===
http_code=200 content_type=application/json; charset=utf-8 size=10657
success: true
organizations:  1 items
bookings:       4 items
threads:        4 items
missedCalls:    3 items
customers:      1 items
services:       5 items
assistantSettings: present (businessName=Apex Plumbing & Mechanical, llmProvider=openai_compatible)
first org: Apex Plumbing & Mechanical / trade = plumbing
first booking: scheduled Water Heater Replacement / Diagnostic
```
**Populated, as predicted** by the controller's `GRANT ridgeline_app TO CURRENT_USER;` fix. The
demo account's `onboardingCompleted: true` also confirms the register→`/onboarding` path will
redirect demo logins to `/` (task-3 shell), matching source behavior.

Cross-check via the proxy:
```
=== proxied /api/neon/status ===
{"connected":true,"latencyMs":1827,"projectId":"frosty-frog-53077141","branch":"production",...,
 "counts":{"users":6,"organizations":6,"services":6,"job_bookings":4,"sms_threads":4,"sms_messages":9,"missed_calls":3,"customers":1},...}
```
Counts agree with `/api/neon/data` → the tenant txn is reading the real Neon DB, not memory.

### 3.6 Origin guard (task 1's seed, unmodified)
```
POST /api/auth/login via :3001 with Origin: http://localhost:3001  -> http_code=200
POST /api/auth/login on  :3000 with Origin: http://localhost:3001  -> http_code=200
POST /api/auth/login on  :3000 with Origin: http://evil.example.com -> http_code=403
```
`server.ts:188-195` is byte-unchanged (read back to confirm). The dev allowlist admits
`http://localhost:3001` and still rejects a foreign origin.

### 3.7 `?mode=` wiring + `/onboarding` route
```
GET /auth?mode=register -> http_code=200
  markers: "Create your Trade Account", "Full Name / Owner Name", "Trade Specialization"
GET /onboarding (no cookie) -> http_code=200 content_type=text/html; charset=utf-8
  marker: "Securing your session..."
```
SSR HTML shows the loading spinner; the wizard renders client-side once `/api/auth/me`
resolves, so the 4 steps are not in the server HTML. This is the expected consequence of
constraint 4 (no Server Components for data).

### 3.8 `:3000` Vite untouched
```
GET /                      -> http_code=200 content_type=text/html
GET /api/neon/data (direct, no cookie) -> http_code=401
```
The SPA still serves, and the API is still auth-gated server-side (401 without a session).

### 3.9 Teardown
```
ERROR: The process "738" not found.
ERROR: The process "764" not found.
SUCCESS: The process with PID 13336 (child process of PID 11908) has been terminated.
SUCCESS: The process with PID 5292 (child process of PID 10652) has been terminated.
SUCCESS: The process with PID 10652 (child process of PID 4540) has been terminated.
=== :3000 / :3001 listener check (expect no LISTENING rows) ===
both ports free (no LISTENING socket)
```
Killed the listening PIDs directly (13336 = :3000, 10652 = :3001) with `taskkill //F //T`,
per the controller's gotcha — the bash `$!` wrappers had already detached and were gone.
`netstat` run with stderr **not** piped anywhere, so "command not found" could not produce a
false negative. Both ports confirmed free.

---

## 4. Deviations from the brief

**D1 — Two extra files: `components/RidgeLineLogo.tsx` + `components/AIIcon.tsx`.** Not in
the brief's file table, but both are hard imports of `AuthPage.tsx` (`AuthPage.tsx:13,15`) and
of `OnboardingPage.tsx` (`OnboardingPage.tsx:16,17`) with no other definition available in
`apps/web`. The brief calls the AuthPage port "self-contained"; the minimal way to honor
constraint 3 (byte-for-byte class names and markup) without redesigning the card is to copy
both as **byte-identical** files. They are pure presentational (`svg`/`div`, no hooks, no data,
no deps) and they belong in `apps/web/components/`, which the brief reserves for components
tasks 4-9 copy into — so they are reusable there, not one-off scaffolding. Alternative was
inlining the SVG into `AuthPage.tsx`, which would have broken the verbatim-copy rule.

**D2 — `/auth` route import is `../../../components/AuthPage`, not the brief's `../../`.** The
brief's snippet is one level short for its own stated path. From
`apps/web/app/(auth)/auth/page.tsx`, `..` → `apps/web/app/(auth)`, `../..` → `apps/web/app`,
`../../..` → `apps/web`. The brief's `../../components/AuthPage` resolves to
`apps/web/app/components/AuthPage`, which does not exist, and it fails the root `tsc` gate:
```
apps/web/app/(auth)/auth/page.tsx(3,26): error TS2307: Cannot find module '../../components/AuthPage' or its corresponding type declarations.
tsc exit=1
```
The `Suspense` wrapper, `'use client'`, the route name, and everything else in the snippet are
verbatim. (My `onboarding/page.tsx` already used three levels and never hit this.)

**D3 — the `showToast` prop was removed from `AuthPageProps` (not just the two named props).**
The brief lists `onAuthSuccess` / `currentUser` under "remove", then separately says
`showToast` → local state. Since the route renders `<AuthPage />` with no props at all,
`AuthPageProps` would have been an empty interface. Shipped as `React.FC` (i.e. `React.FC<{}>`)
so there is no dead type.

**D4 — `handleComplete`'s provider-state writes dropped** (see §2). Unavoidable: task 2 has no
`DataProvider`, and the brief's own `handleComplete` spec is just the toast + `push` + `refresh`.

No other deviation. No new dependency was added (`package.json` in `apps/web` is untouched);
`next build` was not run; `OnboardingWizard.tsx` was not ported; `src/` is untouched.

---

## 5. Findings / notes for the controller

1. **Root `tsc` also typechecks `apps/web/**`.** Root `tsconfig.json` has no `include`/`exclude`
   and no `reference` to the app tsconfig, so every new `apps/web` file is in scope for the
   `npx tsc --noEmit` gate. This currently passes only because `next`, `react`, `lucide-react`,
   `clsx`, and `tailwind-merge` all resolve from `apps/web/node_modules` by upward walk, and
   the root config's `types: ["vite/client"]` still supplies DOM lib. **Any future Sprint 4 task
   that adds a package to `apps/web/package.json` without also having it at the repo root must
   survive this.** Also: a root-`tsc` import error in `apps/web` shows up as a *root* gate
   failure, which is easy to misread — D2 above is exactly that trap.
2. **`mockData.ts:56` is already scrubbed.** The brief and `AGENTS.md` both flag a hardcoded
   live-looking `openaiApiKey` at `src/mockData.ts:56`; in the current tree it reads
   `openaiApiKey: ''` (sprint 3 commit `b0ad294` removed it). The copy is byte-identical, so
   nothing was lost — but the "secret" is no longer in the file, and `server.ts:129`'s
   `DEFAULT_OPENAI_API_KEY` is the remaining copy. Worth a line in whatever security task
   picks this up, so it is not written up as a regression.
3. **`animate-in fade-in slide-in-from-bottom-2` is inert in both apps.** These are
   `tailwindcss-animate` utilities; that plugin is not installed and the classes are defined
   nowhere in `src/index.css` or `apps/web/app/globals.css`. The toast/step transitions
   therefore render with no animation in the Vite app today and will not animate in
   `apps/web` either. Kept verbatim per constraint 3 (they are in the required markup); if
   motion matters, add the plugin once for both apps rather than hand-writing the keyframes
   in a ported file.
4. **`/api/neon/data` for the demo org is now real data, so the mock fallback is no longer
   masking failures.** Task 3's `DataProvider` will seed from live rows (1 org, 4 bookings,
   4 threads, 3 missed calls, 1 customer, 5 services) rather than `mockData.ts`. Note the demo
   tenant's `customers` row is literally named `Customer` — a placeholder row in the seeded DB,
   not a porting bug. If task 3+ asserts against `mockData.ts` fixtures, expect divergence.
5. **`Set-Cookie` survives the rewrite, confirmed end-to-end**, and the cookie is
   `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` with **no `Domain`** attribute — so it is
   host-only for `localhost` and identical for `:3000` and `:3001`. In dev, a browser session
   that has already visited `localhost:3000` shares the same `ridgeline_session` cookie
   between the two ports. That is what makes the Vite app "log in for free" once a demo login
   is done through `:3001`; not a bug, but the controller's browser gate should not be
   confused by it. A real cross-host deployment (e.g. `app.` / `api.`) *will* need
   `SameSite=None; Secure` plus an explicit `Domain` — nothing in this task sets that, and
   `sameSite: 'lax'` in `server.ts` is deliberate for the same-host two-port setup.
6. **Register was not executed end-to-end by me.** Creating an account writes a real row to
   the real Neon DB (`users: 6` today) and the brief's register gate is a browser interaction
   the controller gates separately. I verified everything up to the API call — the register
   tab renders server-side at `/auth?mode=register` with all fields, and the post-auth
   navigation is `router.push(user.onboardingCompleted ? '/' : '/onboarding')` so a fresh
   account lands on the wizard. The remaining unproven link is `POST /api/auth/register`
   through the proxy → `GET /onboarding` client-side render.

## 6. For Sentinel / Probe

- **Sentinel:** audit the two `apps/web/app/(auth)/*/page.tsx` client-side guards. The
  `/onboarding` guard is a `useEffect` → `router.replace('/auth')` with a `render null` body;
  it is a UX redirect, **not** an authorization boundary. The real boundary is still
  `requireAuth` in `server.ts` — confirmed: `GET /api/neon/data` on `:3000` without a cookie
  returns 401. Nothing in this task moved auth server-side; check that no future task starts
  treating the route guard as security.
- **Sentinel:** the two extra component files (D1) are outside the brief's file table — confirm
  they are acceptable scope, and that tasks 4-9 reuse rather than re-copy them.
- **Probe:** exercise the register tab in a real browser (creates DB state — coordinate before
  running), confirm the toast appears and the URL lands on `/onboarding` with all 4 steps, and
  confirm the 4 s auto-clear.
- **Probe:** hard-refresh `/auth` and `/onboarding` directly (deep link / F5) — the Suspense
  boundary and the client-only session check are the two things that can differ between a
  client-side navigation and a cold load.
- **Probe:** re-run `npx tsc --noEmit` at the root after *any* `apps/web/package.json` change
  in a later task (finding 1).
