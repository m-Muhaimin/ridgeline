# Task 2 — Port shared lib + auth UI into `apps/web`

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §2.3, §2.4, §3 row 2.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Every `apps/web` API call goes through `apiFetch` with **relative** paths and `credentials: 'include'`. No absolute API base URL, no bare `fetch(...).json()`.
3. Ported code is a move, not a redesign: class names, copy, layout, prop shapes, state logic copied verbatim. No styling changes, no new dependencies, no API changes.
4. No `'use client'` inside `apps/web/components/**` or `apps/web/lib/**` — the client boundary is the page. No Server Components for data.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint`. No `next build` gate this task.
6. Relative imports only (`../types`, `../lib/utils`) — no `@/` alias in ported code.

## Goal
Copy the shared client modules and the two unauthenticated routes into `apps/web`, so `/auth` and `/onboarding` are live and login through the :3001 proxy. This is the sprint's first real cookie round-trip proof (PLAN §5 risk #1).

## Files (all **Create**; all are copies)
| New file | Copy from |
|---|---|
| `apps/web/types.ts` | `src/types.ts` **+ one appended line** (below) |
| `apps/web/lib/apiFetch.ts` | `src/lib/apiFetch.ts` (verbatim, 63 lines) |
| `apps/web/lib/utils.ts` | `src/lib/utils.ts` (verbatim) |
| `apps/web/lib/timezones.ts` | `src/lib/timezones.ts` (verbatim) |
| `apps/web/lib/chartUtils.ts` | `src/lib/chartUtils.ts` (verbatim) |
| `apps/web/lib/triage.ts` | `packages/domain/safety/triage.ts` (verbatim — it has no imports of its own) |
| `apps/web/mockData.ts` | `src/mockData.ts` (verbatim, 780 lines) |
| `apps/web/components/AuthPage.tsx` | `src/pages/AuthPage.tsx` (ported — see below) |
| `apps/web/components/OnboardingPage.tsx` | `src/pages/OnboardingPage.tsx` (ported — see below) |
| `apps/web/app/(auth)/auth/page.tsx` | new thin route wrapper |
| `apps/web/app/(auth)/onboarding/page.tsx` | new thin route wrapper (owns a small session check) |

Do **not** port `src/components/OnboardingWizard.tsx` — nothing imports it (grep: only its own file). Task 10 deletes it.

## `apps/web/types.ts`
Verbatim copy, then **append** (it is the shared type contract; task 3 and task 9 both import it, so it cannot live in either of their files):
```ts
export type SettingsSubTab = 'general' | 'rates' | 'ai_dispatcher' | 'billing';
```

## `apps/web/lib/apiFetch.ts`
Verbatim. It is already correct for Next: relative `path`, `credentials: options.credentials ?? 'include'`, `res.ok` + `content-type` JSON guard. **Add nothing** — no `API_BASE`, no `baseUrl` option, no server-side branch.

## `apps/web/mockData.ts`
Verbatim, including the hardcoded `openaiApiKey` at `src/mockData.ts:56`. Do not add any new key. (Removing that secret is a separate security task, not Sprint 4.)

## `apps/web/components/AuthPage.tsx` — port rules
- Copy the whole component; keep every Tailwind class, the login/register tab toggle, the `?mode=` initial tab, the register fields, and the **one-click demo login** button (`handleQuickDemo`, posts `mark@apexplumbingpro.com` / `Password123!`) byte-for-byte.
- Props: the current interface takes `onAuthSuccess` / `showToast` / `currentUser` from `App.tsx`. In `apps/web` there is no provider on `/auth`, so **remove the `onAuthSuccess` and `currentUser` props** and keep the component self-contained:
  - `onAuthSuccess(user)` → replace with the local tail of the same function: `router.push(user.onboardingCompleted ? '/' : '/onboarding')`. (`App.tsx:172-176` does exactly this.)
  - `showToast(msg)` → add local state `const [toast, setToast] = useState<string|null>(null)` + a local `showToast` that sets it and clears after 4000 ms, and render the **same toast markup** as `App.tsx:596-601` (`fixed bottom-4 right-4 z-50 …` + `CheckCircle2` with `text-emerald-400`).
- Router: `useNavigate`/`useLocation` → `const router = useRouter()` and `const searchParams = useSearchParams()` from `next/navigation`. `navigate(x)` → `router.push(x)`; `navigate('/', { replace: true })` → `router.replace('/')`.
- The "already signed in" effect (`React.useEffect(() => { if (currentUser) navigate('/') }, ...)`) is **deleted** — the `(dashboard)` layout owns that guard. The `/auth` route is reached only when unauthenticated.
- Every `apiFetch` call keeps `credentials: 'include'`.

## `apps/web/app/(auth)/auth/page.tsx`
```tsx
'use client';
import { Suspense } from 'react';
import { AuthPage } from '../../components/AuthPage';

export default function AuthRoute() {
  return <Suspense fallback={null}><AuthPage /></Suspense>;
}
```
The `Suspense` boundary is **required**: `AuthPage` uses `useSearchParams()`, and without a boundary `next build` fails with "useSearchParams() should be wrapped in a suspense boundary".

## `apps/web/components/OnboardingPage.tsx` — port rules
- Copy verbatim (569 lines), keep `defaultServicesByTrade`, the 4 steps, and `handleFinishOnboarding` → `apiFetch('/api/auth/complete-onboarding', …)`.
- `useState` stays. There is no router hook in this component.
- Props: keep `user: User`, `onComplete`, `showToast` **only if** the route supplies them; the route supplies all three (see below), so the file's props are unchanged from `src/`.

## `apps/web/app/(auth)/onboarding/page.tsx` — owns its own session check
`(dashboard)` is not a parent of `/onboarding`, so this page replicates `ProtectedRoute` (`App.tsx:47-70`) locally:
- `'use client'`; `useEffect` on mount → `apiFetch('/api/auth/me')`; store `user: User | null` and `loading: boolean`.
- `loading` → render the exact spinner markup from `App.tsx:52-59` (`min-h-screen flex items-center justify-center bg-neutral-50` + `h-8 w-8 border-4 border-neutral-200 border-t-neutral-900 rounded-full animate-spin` + "Securing your session...").
- `!user` (and not loading) → `useEffect` calls `router.replace('/auth')`; render `null`.
- `user` → render `<OnboardingPage user={user} onComplete={handleComplete} showToast={showToast} />` with the same local-toast pattern as `AuthPage`.
- `handleComplete` body = `router.push('/'); router.refresh();` plus a success toast `"Setup complete! Dispatch engine online for ${org.name}."` (from `App.tsx:198-199`). Do **not** redirect away when `user.onboardingCompleted === true` — the wizard is re-runnable from the sidebar ("Launch Onboarding Wizard"), which is current behavior.

## Verification
```bash
npx tsc --noEmit && npm test
npm --prefix apps/web run lint
npm --prefix apps/web run dev        # :3001
```
Browser/curl gates (root `npm run dev` on :3000 must be up):
- `curl -s http://localhost:3001/api/auth/me` → `{"success":true,"user":null}` (proxy + cookie route live)
- Browser `http://localhost:3001/auth` → sign-in card renders with both tabs and the demo button; fonts load (Bricolage Grotesque in the heading).
- **Cookie round-trip:** click "One-Click Demo Login". DevTools → Network → `POST /api/auth/login` must return `200` with a `Set-Cookie: ridgeline_session=…` header **on the :3001 response** (proving the rewrite forwards `Set-Cookie`). The browser must then land on `/` (Next 404 is expected — the shell is task 3) with a "Welcome back…" toast. Re-`curl -s -b <cookie> http://localhost:3001/api/auth/me` must return the user.
- Register tab: creates an account and lands on `/onboarding` with the 4-step wizard.
- `http://localhost:3000` (Vite) is untouched and still works.

## Non-goals
No `DataProvider`, no sidebar/header/shell, no dashboard routes, no ported view components. No changes to `src/`. No `next build` requirement. Do not touch the origin guard (task 1 did).

## Where it fits
This task owns every file under `apps/web/lib/`, plus `types.ts` and `mockData.ts`, for the rest of the sprint. Tasks 4–9 copy their own components into `apps/web/components/` and import these via relative paths (`../types`, `../lib/utils`, …).
