# Task 5 report — Dispatch page (`/dispatch`)

**Status:** complete. All three static gates green.
**Agent:** Wired (backend/API)
**Date:** 2026-09-28

---

## Files (both **Create**, exactly the two this task owns)

| File | Action | Size |
|---|---|---|
| `apps/web/components/DispatchBoard.tsx` | Create (byte-identical copy of `src/components/DispatchBoard.tsx`) | 439 lines / 19591 bytes |
| `apps/web/app/(dashboard)/dispatch/page.tsx` | Create (port of `App.tsx:857-871`) | 17 lines / 617 bytes |

No other file was created, edited, or deleted. No server was booted (binding rule for this
parallel wave).

---

## 1. Byte-identical copy — proof

```
$ cp src/components/DispatchBoard.tsx apps/web/components/DispatchBoard.tsx
$ diff src/components/DispatchBoard.tsx apps/web/components/DispatchBoard.tsx
diff: NO DIFFERENCES
$ cmp src/components/DispatchBoard.tsx apps/web/components/DispatchBoard.tsx
cmp: BYTE-IDENTICAL
$ sha256sum src/components/DispatchBoard.tsx apps/web/components/DispatchBoard.tsx
cd50cdbf8e75df51f0ef42a7123c5420b9eadebf0fcd2a8526376b5997d25c3c *src/components/DispatchBoard.tsx
cd50cdbf8e75df51f0ef42a7123c5420b9eadebf0fcd2a8526376b5997d25c3c *apps/web/components/DispatchBoard.tsx
$ wc -l -c
 439 19591 src/components/DispatchBoard.tsx
 439 19591 apps/web/components/DispatchBoard.tsx
$ grep -c "use client" apps/web/components/DispatchBoard.tsx
0
```

Confirmed: identical sha256, identical line/byte counts, **no** `'use client'` directive (it is a
client component by virtue of being imported from a client page — global constraint 4 satisfied).

### Copy-rule compliance (brief §"copy rules")

Untouched, as required:
- recharts usage (the `AreaChart` / `ResponsiveContainer` / gradient-defs block, lines 227-266)
- the 4 status columns' render logic + the `En Route` / `Arrived` / `Complete` action buttons
- prop names `onUpdateStatus` / `onSendEtaSms` / `onOpenThread` / `onOpenNewBooking` (+ the
  optional, unused-by-the-page `onOpenSimulateSms`)
- internal `useState` (`selectedDay`, `statusFilter`, `searchQuery`) and the `useMemo` metrics
- the `TabChartSkeleton` usage in **both** the `isLoading && bookings.length === 0` branch and the
  `isLoading || isChartLoading` chart branch
- no new columns, no filtering/sorting added, no "today" pre-filter, no date-handling change

### All of the copy's imports resolve inside `apps/web` (verified, read-only)

| Import in the copy | Resolves to | State |
|---|---|---|
| `react` | `apps/web/node_modules/react` | present |
| `lucide-react` | `apps/web/node_modules/lucide-react` | present |
| `recharts` | `apps/web/node_modules/recharts` | present |
| `../types` → `JobBooking`, `BookingStatus` | `apps/web/types.ts` | present (strict superset of `src/types.ts`; only delta is 2 appended lines, `SettingsSubTab`) |
| `../lib/chartUtils` → `calculateSevenDaysMetrics` | `apps/web/lib/chartUtils.ts` | `diff src/lib/chartUtils.ts apps/web/lib/chartUtils.ts` → **IDENTICAL** |
| `../lib/utils` → `formatCurrency` | `apps/web/lib/utils.ts` | present, exports `formatCurrency` |
| `./EmptyState` | `apps/web/components/EmptyState.tsx` | `diff` → **IDENTICAL** |
| `./AIIcon` | `apps/web/components/AIIcon.tsx` | `diff` → **IDENTICAL** |
| `./ChartSkeleton` → `TabChartSkeleton` | `apps/web/components/ChartSkeleton.tsx` | `diff` → **IDENTICAL**; task 4's file, imported, **not** re-created |

> Note: the brief's §"copy rules" import list omits `../lib/utils` (`formatCurrency`, line 28 of
> the copy). It is imported and it resolves; the omission is in the prose list only, not in the
> component.

---

## 2. `app/(dashboard)/dispatch/page.tsx` — the whole file

Written **verbatim** from the brief's code block (lines 26-42). Proof:

```
$ sed -n '26,42p' plans/sprint-4/task-05-dispatch.md > /tmp/brief_dispatch.tsx
$ diff /tmp/brief_dispatch.tsx "apps/web/app/(dashboard)/dispatch/page.tsx"
PAGE: IDENTICAL TO BRIEF BLOCK
$ sha256sum /tmp/brief_dispatch.tsx "apps/web/app/(dashboard)/dispatch/page.tsx"
49d3eac0115b7a64ca219648e63c98e2de90c41b23be369fcaec93850504feb4  (both)
```

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

### Prop wiring (brief §"That is the entire mapping of App.tsx:857-871")

| `App.tsx:857-871` | Dispatch page | Provider member it lands on |
|---|---|---|
| `bookings={bookings}` | `bookings={bookings}` | `useData().bookings` |
| `onUpdateStatus={handleUpdateStatus}` | same | `DataProvider.tsx:532` |
| `onSendEtaSms={handleSendEtaSms}` | same | `DataProvider.tsx:514` |
| `onOpenThread={(threadId) => { if (threadId) { setSelectedThreadId(threadId); setActiveTab('sms'); } }}` | `onOpenThread={(threadId) => { if (threadId) openThread(threadId); }}` — **`if (threadId)` guard preserved** | `DataProvider.tsx:667-670` = `setSelectedThreadId(threadId); router.push('/sms')` |
| `onOpenNewBooking={() => setIsNewBookingOpen(true)}` | same | `DataProvider.tsx:119` |
| `isLoading={isDataLoading}` | same | `DataProvider.tsx:112` |
| `onOpenSimulateSms` | **not passed** — matches `App.tsx`, and the prop is optional | — |

Cross-checked against the live source, `src/App.tsx:856-871`: the block is identical to what the
brief quotes.

### Brief-specific do's, all honoured

- **Modal comes from the shell — no `NewBookingModal` import or render in the page.** Confirmed
  `DashboardShell.tsx:7,143-144` imports and renders it from `isNewBookingOpen`, so
  `setIsNewBookingOpen(true)` is sufficient.
- **No page-level `<main>` / padding / max-width wrapper** — `DashboardShell.tsx:136` owns
  `<main className="flex-1 p-3 sm:p-5 md:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0">`. The page
  returns only `<DispatchBoard/>`, exactly as instructed.
- **Data only from `useData()`.** The page issues no fetch and holds no state.
- **No doc comment added.** The brief supplied the entire file and the controller said to write it
  exactly per the brief, so the page is the brief's 17 lines verbatim. (The already-landed
  overview page carries a longer JSDoc block; noted only so the inconsistency is a decision rather
  than an oversight. If the controller wants a house-style port comment on every page, say so and I
  will add one — it is a comment, not a behaviour change.)

### Frozen-file expectations the brief's runtime checklist relies on (verified read-only, not modified)

- `Header.tsx:47-48` — `case '/dispatch': return 'Dispatch Board & Schedule'` ✓
- `AppSidebar.tsx:119-127` — "Dispatch Board" entry, `isActive('/dispatch')`, `router.push('/dispatch')` ✓
- `DataProvider.tsx:667-670` — `openThread` sets the thread **and** `router.push('/sms')`, so the
  booking's thread icon lands on `/sms` with that thread selected ✓
- `app/(dashboard)/sms/` exists (parallel task's route), so `router.push('/sms')` resolves ✓

---

## 3. Gate outputs (verbatim)

All three run from the repo root, after both files were written. No server was started.

### Gate 1 — `npx tsc --noEmit`

```
===== GATE 1: npx tsc --noEmit =====
GATE1_EXIT=0
```
No output, exit 0.

Proof it actually covered my files (root `tsconfig.json` has no `include`, so it sweeps
`apps/web/**`):
```
$ npx tsc --noEmit --listFilesOnly | grep -iE "dispatch"
.../apps/web/components/DispatchBoard.tsx
.../apps/web/app/(dashboard)/dispatch/page.tsx
.../src/components/DispatchBoard.tsx
$ npx tsc --noEmit --listFilesOnly | grep -c "apps/web"
563
```

### Gate 2 — `npm test`

```
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1859.8663
GATE2_PIPE_EXIT=0
```
159/159 pass, exit 0 — count matches the brief's expected 159.

### Gate 3 — `npm --prefix apps/web run lint`

```
> ridgeline-web@0.0.0 lint
> tsc --noEmit

GATE3_EXIT=0
```
No output, exit 0.

---

## 4. Deviations

**None.** No file outside the two was touched; no prop renamed; no import, filter, sort, column or
date-handling change; no `ChartSkeleton.tsx` edit; no provider edit; no API call added; no `'use client'`
in `components/**`.

---

## 5. Findings (flagged, deliberately **not** acted on)

**F1 — the "Today"/"Tomorrow" filter on `/dispatch` is UTC-based while `/` is org-timezone-based.**
The copied board computes its day buckets at `DispatchBoard.tsx:62,65`:
```ts
const todayStr = new Date().toISOString().split('T')[0];
```
The overview page computes its own "Today" deliberately differently
(`app/(dashboard)/page.tsx:44-53`, with a comment explaining exactly this hazard):
```ts
const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: currentOrg?.timezone || 'UTC', ... }).format(new Date());
```
For any org west of UTC, between 20:00 local and midnight the dispatch board's **Today** tab count
and the overview's **Today's Dispatches** list disagree, and the board mislabels each card's
relative date (`{isToday ? 'Today' : isTomorrow ? 'Tomorrow' : job.date}`, lines 302-303/319). It
also mismatches whatever the `/api/bookings` date strings are anchored to.
The brief is explicit — byte-identical copy, "no date handling changes" — so I preserved the
upstream behaviour verbatim. **This is a real cross-page inconsistency inherited from the Vite
app**, not something this port introduced. Fixing it needs either a shared
`currentOrg.timezone`-aware day helper in `apps/web/lib/` (task 2's file — not mine) or an
explicit controller decision. Recommend a follow-up ticket; do not let it be "fixed" ad hoc in
either page.

**F2 — the brief's runtime bullet "'New Job' / book buttons open the shell's `NewBookingModal`".**
There is no "New Job" control in `DispatchBoard`. `onOpenNewBooking` has exactly one call site
(`DispatchBoard.tsx:282`), the `EmptyState` primary action labelled **"+ Book Manual Job"**, and it
only renders when the filtered list is empty. So the check is accurate in substance (that button
does open the shell's modal) but the "New Job" label does not exist on this page. No change made;
callers should expect the check to be exercised via the empty-state action.

**F3 — the brief's "kanban" wording does not match the component.** `DispatchBoard` renders a
**filter bar + 7-day velocity chart + a responsive card grid** (`grid-cols-1 md:grid-cols-2
lg:grid-cols-3`), not status columns. There are no drag-and-drop status columns in the Vite source
either, so the strangler-fig port is faithful; only the brief's prose is off. Probe should compare
card-by-card against :3000 rather than looking for columns.

**F4 — one unexercised prop.** `onOpenSimulateSms?: () => void` is declared in
`DispatchBoardProps` and destructured in the copy but has **no call site in the file**, and the page
does not pass it. Same as `App.tsx` today. Left verbatim per the copy rules — no dead code was
introduced by me, but Sentinel may want it flagged for a later cleanup.

**F5 — no runtime verification in this wave.** Per the binding rule, no `npm run dev` /
`next dev` was booted, so none of the brief's browser checks (status PATCH firing, ETA flow, thread
navigation, skeleton, chart parity) were executed by me. The controller's combined runtime sweep
is the first place those get exercised. Static confidence is high: every import resolves to an
existing, verified-identical file; the page body is the brief's bytes; the provider members are all
present in `DataContextValue` and in the provider's `value` object (`DataProvider.tsx:679-723`).
Data being live from Neon (real bookings) changes only what the sweep displays, not this code.

---

## 6. For Sentinel / Probe

**Sentinel audit:**
- Confirm the sha256 of `apps/web/components/DispatchBoard.tsx` is still
  `cd50cdbf8e75df51f0ef42a7123c5420b9eadebf0fcd2a8526376b5997d25c3c` (any drift means someone
  "fixed" the date bug in place, or touched the copy).
- Confirm the page still contains no `NewBookingModal` and no `<main>` wrapper, and that the only
  mutation of app state is via `useData()`.
- Confirm no other page/route was added under `app/(dashboard)/` by this task.

**Probe, in the runtime sweep:**
1. `/dispatch` vs :3000 — filter bar labels/counts, card content (service title, customer, phone,
   address, notes, price, "Booked via AI SMS"/"Missed Call converted"/"Manual entry", emergency
   flag, status pill incl. the `ON SITE` special-case for `in_progress`), and the velocity chart
   (2 areas, dashed indigo total, solid blue completed, tooltip copy).
2. Loading state → the `TabChartSkeleton` variant titled "7-Day Dispatch Workload & Execution" with
   `type="area"`, accent `bg-blue-600`, legend `['Total Dispatched', 'Completed']`.
3. Empty state → `EmptyState` with badge "Dispatch Calendar Ready", primary action "+ Book Manual
   Job"; setting a search/status/day filter swaps the primary action context to "Clear Filters".
4. Status chain per card: `En Route` (scheduled) → ETA SMS + `PATCH {status:'en_route'}`;
   `Arrived` → `PATCH {status:'in_progress'}`; `Complete` → `PATCH {status:'completed'}`.
5. Thread icon on a card → lands on `/sms` with that thread selected (provider does
   `setSelectedThreadId` + `router.push('/sms')`).
6. "+ Book Manual Job" opens the shell's `NewBookingModal` (not a page-level one).
7. **F1 tripwire:** set the org to a western timezone and run the clock past 20:00 local (or
   compare against a booking dated "today" in org time) — expect the dispatch "Today" count to
   disagree with the overview's "Today's Dispatches". Expected to reproduce; it is inherited
   behaviour, not a port regression. Do not file it as a task-5 regression.
