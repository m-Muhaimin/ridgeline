# Task 4 — Overview page (`/`)

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §3 row 4. Port of `src/App.tsx:650-853`.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Data comes **only** from `useData()` (task 3's contract). All API access lives in the provider.
3. Ported code is a move, not a redesign: class names, copy, layout, component internals copied verbatim.
4. No `'use client'` inside `apps/web/components/**`; the page itself starts with `'use client'`.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint`.
6. **File-disjoint:** this task owns only the three component files + `app/(dashboard)/page.tsx` listed below. Never edit task 3's shell/provider files or task 2's `lib/`.

## Goal
Replace the task-3 placeholder at `/` with the real overview: 7-day bookings chart, 4 metric cards, today's dispatch list, missed-call triage bar.

## Files (all **Create**/overwrite)
| File | Source |
|---|---|
| `apps/web/components/CompletedBookingsChart.tsx` | copy of `src/components/CompletedBookingsChart.tsx` (verbatim) |
| `apps/web/components/ChartSkeleton.tsx` | copy of `src/components/ChartSkeleton.tsx` (verbatim) |
| `apps/web/components/MetricCards.tsx` | copy of `src/components/MetricCards.tsx` (verbatim) |
| `apps/web/app/(dashboard)/page.tsx` | **overwrite** the placeholder; port of `App.tsx:650-853` |

`ChartSkeleton` is copied here (not task 6/7/8) because `CompletedBookingsChart` and `MetricCards` import it (`export function ChartSkeleton`, `TabChartSkeleton`). Tasks 5, 7 and 8 **import it from this task's copy** — do not create a second `ChartSkeleton.tsx`.

## `app/(dashboard)/page.tsx`
Start with `'use client'`. `import { useRouter } from 'next/navigation';` and
`const { bookings, missedCalls, threads, settings, isDataLoading, unconvertedCallsCount, handleSendEtaSms, handleUpdateStatus, setIsNewBookingOpen, openThreadForPhone } = useData();`
`const router = useRouter();`
`const todayStr = new Date().toISOString().split('T')[0];` and
`const todayBookings = bookings.filter(b => b.date === todayStr);` (`App.tsx:567-568`).

Copy the JSX from `App.tsx:652-853` in order, with these five behavior mappings (everything else — wrappers, `divide-y` lists, status badge colors, the `formatCurrency(job.estimateAmount)` call, the "Next opening today" footer, the `"No jobs scheduled for today…"` empty text — stays byte-identical):
1. `<CompletedBookingsChart bookings={bookings} settings={settings} isLoading={isDataLoading} />` (`655-659`) and `<MetricCards bookings={bookings} missedCalls={missedCalls} threads={threads} isLoading={isDataLoading} />` (`662-667`).
2. Today-dispatch card header title stays `Today's Dispatches ({todayBookings.length} jobs)` with the `Calendar` icon; subtitle stays `Route optimization for {settings.tradespersonName}`.
3. **"Full Schedule" button** (`686-692`) → `onClick={() => router.push('/dispatch')}`.
4. Per-job action buttons keep their labels/classes and wire to provider handlers: `En Route` → `onClick={() => handleSendEtaSms(job)}`; `Arrived` → `handleUpdateStatus(job.id, 'in_progress')`; `Complete` → `handleUpdateStatus(job.id, 'completed')` (conditional rendering on `job.status` unchanged).
5. **"Add Manual Job"** (`782-788`) → `onClick={() => setIsNewBookingOpen(true)}`. The modal itself is rendered by `DashboardShell` (task 3) — do **not** render `NewBookingModal` here and do not copy that file.
6. Missed-call triage bar title stays `Recent Missed Calls ({unconvertedCallsCount} pending reply)`; **"All Calls"** button (`799-806`) → `router.push('/missed-calls')`; `missedCalls.slice(0, 3)` unchanged.
7. The per-row message-square "Open SMS Thread" button (`832-844`) → `onClick={() => openThreadForPhone(call.callerPhone)}` (the provider does the thread lookup + `selectThread` + `router.push('/sms')`).

Imports: the same `lucide-react` icons as `App.tsx:26-36` (only `Calendar, MessageSquare, PhoneMissed, ArrowRight, CheckCircle2, Truck, AlertTriangle, MapPin, Plus` are used by this page), plus `formatCurrency` from `../lib/utils`.

## What must NOT change
No Tailwind class edits, no new cards, no reordering, no recharts configuration changes, no skeleton tuning. `MetricCards` and `CompletedBookingsChart` are byte-identical copies — do not "modernize" them.

## Verification
```bash
npx tsc --noEmit && npm test && npm --prefix apps/web run lint
```
Browser, logged in on :3001:
- `/` renders the 7-day chart + 4 metric cards + today's dispatch card + missed-call bar, visually matching the current app on :3000 (compare side by side).
- With data loading, skeletons show; after load, real data shows.
- "Full Schedule" → URL `/dispatch` (page 404s until task 5 — confirm the URL changed).
- "All Calls" → `/missed-calls`.
- Message-square on a missed-call row → `/sms` (thread selected in state).
- "En Route" / "Arrived" / "Complete" update the row and fire `PATCH /api/bookings/:id` (check Network) + toast.
- "Add Manual Job" opens the shell's modal; submitting posts `POST /api/bookings` and a toast appears.
- No console errors other than the known optional-chaining warnings.

## Non-goals
No new components, no API calls, no provider changes, no chart redesign, no `useSearchParams`, no server component. Do not create `ChartSkeleton.tsx` variants or copy `src/App.tsx` itself.

## Where it fits
First of the five page tasks (4–9) that run **in parallel** against the frozen task-3 shell and the task-3 `useData()` contract.
