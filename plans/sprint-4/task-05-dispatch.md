# Task 5 — Dispatch page (`/dispatch`)

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §3 row 5. Port of `src/App.tsx:856-871`.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Data comes **only** from `useData()` (task 3's contract). All API access lives in the provider.
3. Ported code is a move, not a redesign: class names, copy, layout, component internals copied verbatim.
4. No `'use client'` inside `apps/web/components/**`; the page itself starts with `'use client'`.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint`.
6. **File-disjoint:** this task owns only the two files listed below. Never edit task 3's shell/provider, task 2's `lib/`, or task 4's `ChartSkeleton.tsx`.

## Goal
Stand up `/dispatch` rendering the full `DispatchBoard` — the kanban plus the 7-day workload velocity chart — with the same prop wiring the Vite app uses today.

## Files (all **Create**)
| File | Source |
|---|---|
| `apps/web/components/DispatchBoard.tsx` | copy of `src/components/DispatchBoard.tsx` (439 lines, **verbatim**) |
| `apps/web/app/(dashboard)/dispatch/page.tsx` | port of `App.tsx:857-871` |

`DispatchBoard` imports `{ TabChartSkeleton }` from `./ChartSkeleton` — that file is **task 4's copy**; import it, do not create a second one.

## `app/(dashboard)/dispatch/page.tsx`
```tsx
'use client';
import { useData } from '../../../components/DataProvider';
import { DispatchBoard } from '../../../components/DispatchBoard';

export default function DispatchPage() {
  const { bookings, isDataLoading, handleUpdateStatus, handleSendEtaSms, openThread, setIsNewBookingOpen } = useData();
  return (
    <DispatchBoard
      bookings={bookings}
      onUpdateStatus={handleUpdateStatus}
      onSendEtaSms={handleSendEtaSms}
      onOpenThread={(threadId) => { if (threadId) openThread(threadId); }}
      onOpenNewBooking={() => setIsNewBookingOpen(true)}
      isLoading={isDataLoading}
    />
  );
}
```
That is the entire mapping of `App.tsx:857-871`:
- `onUpdateStatus` → `handleUpdateStatus`
- `onSendEtaSms` → `handleSendEtaSms`
- `onOpenThread={(threadId) => { if (threadId) { setSelectedThreadId(threadId); setActiveTab('sms'); } }}` → `openThread(threadId)` (guard `if (threadId)` preserved; the provider does the set + `router.push('/sms')`)
- `onOpenNewBooking` → `setIsNewBookingOpen(true)` (modal is rendered by `DashboardShell`)
- `isLoading` → `isDataLoading`

No other page-level markup: the `<main>` padding/max-width wrapper comes from `DashboardShell`, exactly as it does today.

## `DispatchBoard.tsx` — copy rules
Byte-identical copy, **including** its `'use client'`-free status (it is a client component by virtue of being imported from a client page). Do not touch its recharts usage, its status columns, its `onOpenThread` / `onSendEtaSms` / `onUpdateStatus` / `onOpenNewBooking` prop names, or its internal `useState`. Its only imports are `react`, `lucide-react`, `recharts`, `../types`, `../lib/chartUtils`, `./ChartSkeleton`, `./EmptyState`, `./AIIcon` — all already exist in `apps/web` (tasks 2 and 4).

## What must NOT change
No prop renames, no new columns, no filtering, no sorting, no "today" pre-filter, no date handling changes. The board's `TabChartSkeleton` usage stays.

## Verification
```bash
npx tsc --noEmit && npm test && npm --prefix apps/web run lint
```
Browser, logged in on :3001:
- `/dispatch` renders the board; compare against :3000 — column headers, booking cards, prices, urgency flags, and the velocity chart look identical.
- Loading state shows the tab skeleton.
- Moving/advancing a booking's status fires `PATCH /api/bookings/:id` and the card updates.
- "En Route" fires the ETA flow (`POST /api/sms/message` for the linked thread + `PATCH /api/bookings/:id` `{status:'en_route'}`) and toasts.
- Clicking the thread link on a booking navigates to `/sms` with that thread selected.
- "New Job" / book buttons open the shell's `NewBookingModal`.
- Header breadcrumb reads "Dispatch Board & Schedule"; sidebar highlights Dispatch Board.

## Non-goals
No provider changes, no API calls, no shared-file edits, no styling changes, no new charting. Do not modify `ChartSkeleton.tsx` (task 4's).

## Where it fits
One of the five file-disjoint page tasks (4–9) that run in parallel on top of the frozen task-3 shell + `useData()` contract. Its only cross-task dependency is reading task 4's `ChartSkeleton.tsx`.
