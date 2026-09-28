# Task 4 report — Overview page (`/`)

**Status:** complete. All three gates green. No server booted (controller owns runtime/browser proof).

## Files (exactly the 4 the brief grants — nothing else touched)

| File | Action | Provenance |
|---|---|---|
| `apps/web/components/CompletedBookingsChart.tsx` | Create | `src/components/CompletedBookingsChart.tsx`, verbatim |
| `apps/web/components/ChartSkeleton.tsx` | Create | `src/components/ChartSkeleton.tsx`, verbatim |
| `apps/web/components/MetricCards.tsx` | Create | `src/components/MetricCards.tsx`, verbatim |
| `apps/web/app/(dashboard)/page.tsx` | **Overwrite** placeholder | port of `src/App.tsx:650-854` |

### File-disjointness

Only these 4 files carry new mtimes (13:26–13:27). Every frozen file kept its
pre-existing mtime, verified across the whole tree:

- Task 3 shell/provider: `DataProvider.tsx` 13:11, `DashboardShell.tsx` 12:44,
  `AppSidebar.tsx` 12:43, `Header.tsx` 12:44, `NewBookingModal.tsx` 12:57,
  `app/(dashboard)/layout.tsx` 12:44 — **untouched**.
- Task 2 `lib/`: all five files 12:35 — **untouched**.
- Root `package.json`, `bun.lock`, `tsconfig.json` — **untouched**.

## Byte-identical copies — confirmed

`cp` (not a re-typed copy), then verified two ways:

```
$ diff src/components/CompletedBookingsChart.tsx apps/web/components/CompletedBookingsChart.tsx  -> IDENTICAL
$ diff src/components/ChartSkeleton.tsx        apps/web/components/ChartSkeleton.tsx         -> IDENTICAL
$ diff src/components/MetricCards.tsx          apps/web/components/MetricCards.tsx           -> IDENTICAL

066c47d54089dbb81a79cd356663610a  src/…/CompletedBookingsChart.tsx  ==  apps/web/…/CompletedBookingsChart.tsx
8ae90a0fe60aa12465bdf0cd9da13b03  src/…/ChartSkeleton.tsx           ==  apps/web/…/ChartSkeleton.tsx
ef3c2019df38101107bb79b11c75e890  src/…/MetricCards.tsx             ==  apps/web/…/MetricCards.tsx
```

Both component imports resolve unchanged inside `apps/web`: `../types` →
`apps/web/types.ts`, `../lib/chartUtils` + `../lib/utils` → `apps/web/lib/*`,
`./AIIcon` → existing `apps/web/components/AIIcon.tsx`, `./ChartSkeleton` → this
task's new copy. No `'use client'` added (global constraint #4 — the page is the
client boundary and it propagates down).

## `page.tsx` — mapping decisions

Starts with `'use client'`. Destructure is the brief's 10 members, **plus
`currentOrg`** (required by the timezone fix below — flagged). `const router = useRouter();`.

I mechanically diffed the ported JSX against `App.tsx:652-853` (whitespace-normalized,
then also with the source's trailing spaces restored on the two component open tags so the
claim is exact). The **only** differences are the three sanctioned mappings:

```diff
  onClick={() => setActiveTab('dispatch')}          →  onClick={() => router.push('/dispatch')}
  onClick={() => setActiveTab('missed_calls')}      →  onClick={() => router.push('/missed-calls')}
- onClick={() => {                                  + onClick={() => openThreadForPhone(call.callerPhone)}
-   const t = threads.find(th => th.customerPhone === call.callerPhone);
-   if (t) { setSelectedThreadId(t.id); setActiveTab('sms'); }
- }}
```

Byte-identical, as required: the two component call sites, the `Calendar` card header
(`Today's Dispatches ({todayBookings.length} jobs)`), the `Route optimization for
{settings.tradespersonName}` subtitle, the `divide-y` lists, the status-badge color ladder,
`formatCurrency(job.estimateAmount)`, the "Next opening today" footer, the
`"No jobs scheduled for today. AI is monitoring for incoming bookings!"` empty text,
`missedCalls.slice(0, 3)`, and the `Recent Missed Calls ({unconvertedCallsCount} pending reply)` title.

The three per-job buttons needed **no** edit — `handleSendEtaSms(job)` and
`handleUpdateStatus(job.id, 'in_progress' | 'completed')` are byte-identical to the
source, because task 3 named the provider handlers the same as App.tsx's local functions.
Same for `setIsNewBookingOpen(true)`.

`NewBookingModal` is **not** rendered here (`grep -E "<NewBookingModal|import .*NewBookingModal"` → no match;
the only `NewBookingModal` string in the file is inside an explanatory comment). It stays
`DashboardShell.tsx:143`.

### Import paths — brief correction, not a deviation

The brief says `formatCurrency` from `../lib/utils`. From
`apps/web/app/(dashboard)/page.tsx`, `../lib/utils` resolves to `apps/web/app/lib/utils`,
which does not exist — the brief wrote that path for the `components/` depth. Used
`../../lib/utils` and `../../components/{DataProvider,CompletedBookingsChart,MetricCards}`,
matching the sibling `app/(dashboard)/layout.tsx:2` convention. Identifiers, order, and
behaviour are exactly as specified; only the relative prefix differs. Without this, tsc fails.

## Timezone hazard — FOUND, FIXED, FLAGGED

**The hazard is real and it is in the brief's own recipe.** The brief mandates
`const todayStr = new Date().toISOString().split('T')[0];` (`App.tsx:567`).

`toISOString()` is **UTC**. `booking.date` is now an accurate `'YYYY-MM-DD'` in the
organization's zone (the controller's `formatCalendarDate` fix). So for the seeded org at
`America/New_York` (UTC-4/-5), between **20:00 and 24:00 local** UTC has already rolled
over: `todayStr` names *tomorrow*, `todayBookings` is `[]`, and the card reads
**"Today's Dispatches (0 jobs) / No jobs scheduled for today"** on an evening that has
real jobs. Four hours a day, exactly the window the last job of the day lands in.

Fixed with the same helper shape and the same locale as `NewBookingModal.tsx:26-28`:

```tsx
const todayStr = new Intl.DateTimeFormat('en-CA', {
  timeZone: currentOrg?.timezone || 'UTC',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
```

`en-CA` yields `YYYY-MM-DD`, so the `b.date === todayStr` comparison is unchanged.
This adds `currentOrg` to the destructure (brief's list omits it) and changes the
`todayStr` line. Both deviations are the sanctioned fix, called out here rather than
silently applied.

### Residual, NOT fixed (task 2's frozen `lib/`)

`apps/web/lib/chartUtils.ts:68` builds the 7-day axis with the same UTC expression:

```ts
const dateStr = d.toISOString().split('T')[0];
```

`calculateSevenDaysMetrics` feeds both `CompletedBookingsChart` and `MetricCards`, so their
`day.isToday` flag — the emerald "Today" pill, the reference-line label, the highlighted
pill — can be off by one in the same 20:00–24:00 window. Consequence: **the dispatch card's
count and the chart's "Today" can disagree in that window.** I did not touch it: it is task
2's frozen `lib/`. Needs a follow-up ticket — same one-line `Intl` fix, threaded through as
a `timeZone` argument.

## Other observations for the controller

1. **`CheckCircle2` is imported but unused.** The brief names it explicitly in the
   9-icon list ("only … are used by this page"), which is very slightly off: its only use in
   `App.tsx` was the toast banner (596-601), which task 3 moved to
   `DashboardShell.tsx:89-94`. I kept the import because the brief enumerates it; nothing
   flags it (`noUnusedLocals` is not set in `apps/web/tsconfig.json`, and web lint is just
   `tsc --noEmit`). Say the word and I'll drop it.
2. **`ChartSkeleton` export names.** The brief refers to "export function `ChartSkeleton`",
   but the file exports `CompletedBookingsChartSkeleton`, `MetricCardsSkeleton` and
   `TabChartSkeleton` — no export literally named `ChartSkeleton`. Copied verbatim as
   specified. **Tasks 5/7/8 must import those three names from
   `apps/web/components/ChartSkeleton`; there is exactly one copy, per the brief.**
3. **"Next opening today: 03:45 PM - 05:00 PM" is a hardcoded string** (`App.tsx:781`),
   not computed from `/api/availability`. It is byte-identical as the brief required, but it
   will be visibly stale against the live schedule. Carried over from the source, not
   introduced here.
4. **Data is live, not fixtures.** `syncFromNeon` overwrites the `mockData` seeds whenever
   `/api/neon/data` returns rows, so the page will render the real 4 bookings / 3 missed
   calls / 4 threads from Neon — *not* the `src/mockData.ts` fixtures. Expect the real
   `Apex Plumbing & Mechanical` rows in browser proof.
5. **`openThreadForPhone` is a no-op when no thread matches the phone** — the provider only
   calls `openThread` on a hit, exactly as `App.tsx:833-839` did inline. So the
   message-square button on an unconverted missed call with no thread does nothing,
   silently, with no toast. Preserved behavior, worth a Probe case.
6. `handleSendEtaSms` optimistically sets `en_route` and fires
   `PATCH /api/bookings/:id`, so the row re-renders with "Arrived" on the same click.

## Verification

All three gates, from the repo root, after the final whitespace edit:

```
$ npx tsc --noEmit
tsc exit: 0

$ npm test
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
test exit: 0

$ npm --prefix apps/web run lint
> ridgeline-web@0.0.0 lint
> tsc --noEmit
web lint exit: 0
```

Baseline preserved: tsc still 0, still 159/159, web lint 0. No test files added or
modified. No `npm run dev` / `next dev` started.

## Handoff notes

- **Probe (browser, :3001):** `/` must show 7-day chart → 4 metric cards → today's dispatch
  card → missed-call bar, with skeletons during load. `Full Schedule` → URL `/dispatch`
  (404s until task 5 — only confirm the URL changed). `All Calls` → `/missed-calls`.
  Message-square on a missed-call row → `/sms` with the thread selected (only if a thread
  matches that phone — see #5). `En Route` / `Arrived` / `Complete` update the row, fire
  `PATCH /api/bookings/:id`, and toast. `Add Manual Job` opens the shell's modal; save
  posts `POST /api/bookings` and toasts.
- **Sentinel (audit):** the sanctioned `todayStr` deviation and the frozen
  `chartUtils.ts:68` UTC axis — the two together are the only places in this page where
  the org's calendar day and UTC can disagree.
- **Not mine, but adjacent:** tasks 5/7/8 import `ChartSkeleton` from this task's copy
  (single source of truth) and will hit the same `chartUtils.ts:68` UTC axis issue in
  their own date filters.
