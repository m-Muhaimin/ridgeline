# Task 8 report — Customers page (`/customers`)

**Status:** COMPLETE. Both files created, byte-identical copy proven, all three static gates green.

**Wave constraints honored:** no server booted (`npm run dev` / `next dev` never invoked — ports
:3000/:3001 are shared across the wave). Verification limited to the three static gates. No file
outside my two was written or edited.

---

## 1. Files

| File | Action | Size |
|---|---|---|
| `apps/web/components/CustomersView.tsx` | **Create** — byte-identical copy of `src/components/CustomersView.tsx` | 18030 bytes / 369 lines |
| `apps/web/app/(dashboard)/customers/page.tsx` | **Create** — verbatim from brief §"the whole file" | 10 lines |

Route resolution: `app/(dashboard)/customers/page.tsx` → `/customers` (the `(dashboard)` group
segment is not part of the URL).

Nothing else touched. Confirmed by construction: the only two write operations in this task were
one `cp` and one file write, both landing inside the two paths above.

---

## 2. Byte-identical copy — confirmed

```
=== diff (empty == identical) ===
diff: no differences
=== cmp byte-for-byte ===
cmp: identical
=== md5 ===
4ed6717e07b9bdd816245010a043a945 *src/components/CustomersView.tsx
4ed6717e07b9bdd816245010a043a945 *apps/web/components/CustomersView.tsx
=== size / lines / eol ===
  369 18030 src/components/CustomersView.tsx
  369 18030 apps/web/components/CustomersView.tsx
  738 36060 total
src/components/CustomersView.tsx:      JavaScript source, Unicode text, UTF-8 text
apps/web/components/CustomersView.tsx: JavaScript source, Unicode text, UTF-8 text
=== 'use client' check (must be absent) ===
0
0 occurrences of 'use client' in components copy
```

Three independent proofs agree: `diff` reports no differences, `cmp` reports byte-for-byte
identity, and the MD5 digests are the same hash. Line count (369), byte count (18030) and encoding
(UTF-8, LF — `file` reports no "with CRLF line terminators" on either side) all match, so no
line-ending translation occurred on copy. The copy contains **zero** `'use client'` directives,
satisfying global constraint 4 (`No 'use client' inside apps/web/components/**`).

---

## 3. Page wiring

`apps/web/app/(dashboard)/customers/page.tsx`, exactly the brief's file:

```tsx
'use client';
import { useData } from '../../../components/DataProvider';
import { CustomersView } from '../../../components/CustomersView';

export default function CustomersPage() {
  const { customers, bookings, isDataLoading } = useData();
  return <CustomersView customers={customers} bookings={bookings} isLoading={isDataLoading} />;
}
```

**Source-of-truth mapping verified against the Vite app** — `src/App.tsx:909-917` reads:

```tsx
{/* TAB 4.5: CUSTOMERS */}
{activeTab === 'customers' && (
  <CustomersView
    customers={customers}
    bookings={bookings}
    isLoading={isDataLoading}
  />
)}
```

One-to-one, three props, in the same order. No page-level wrapper, no header row, no search box,
no extra cards — `<main>` padding/max-width come from `DashboardShell`
(`flex-1 p-3 sm:p-5 md:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0`), exactly as in the Vite app.

### Contract checks (all read-only, no edits)

- **`useData()` consumption: 3 of 43 members** — `isDataLoading` (`DataProvider.tsx:54`),
  `bookings` (`:57`), `customers` (`:60`). All three exist in the frozen `DataContextValue`. The
  other 40 are untouched, so the frozen task-3 contract is not stretched.
- **Relative import depth** — from `app/(dashboard)/customers/`, `..` = `(dashboard)/`, `../..` =
  `app/`, `../../..` = `apps/web/`. So `../../../components/...` lands on `apps/web/components/`.
  Correct.
- **Task 4 cross-read** — `CustomersView` imports `{ TabChartSkeleton } from './ChartSkeleton'`,
  which resolves to task 4's existing `apps/web/components/ChartSkeleton.tsx`. Confirmed it exports
  `TabChartSkeleton` (`ChartSkeleton.tsx:166`) with every prop the copy passes: `title`,
  `subtitle`, `badgeText`, `accentColor`, `type: 'area'`, `legendLabels`
  (`TabChartSkeletonProps`, `:156-164`). No second skeleton file was created.
- **Task 2 cross-read** — `../types` supplies `Customer` / `JobBooking` (`types.ts:131`, `:5`);
  `../lib/utils` supplies `formatCurrency` (`lib/utils.ts:8`); `../lib/chartUtils` supplies
  `calculateSevenDaysMetrics` (`lib/chartUtils.ts:56`), whose 3-param signature takes defaulted
  `bookings / missedCalls / threads`, so the copy's `calculateSevenDaysMetrics(bookings, [], [])`
  call typechecks. No `lib/` or `types.ts` file was edited.
- **Frozen task-3 chrome already targets this route** (read-only greps):
  `Header.tsx:53-54` returns `'Customer Profiles'` for `case '/customers'`, and
  `AppSidebar.tsx:173-174` has `isActive('/customers')` + `router.push('/customers')`. My route
  matches what the sidebar links to, so the sidebar highlight and header title land with no
  chrome change.
- **No API calls, no `'use client'` in the component** — the page is pure presentation over
  `useData()`. Nothing in either file issues a `fetch`.

---

## 4. Gate outputs (verbatim)

All three run from repo root, cwd = `C:\Users\muhai\Downloads\remix-ridgeline`.

### Baseline (captured before writing any file, for attribution)

```
=== BASELINE: root tsc ===
exit=0
=== BASELINE: npm test ===
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2225.2659
=== BASELINE: apps/web lint ===
> ridgeline-web@0.0.0 lint
> tsc --noEmit
```

Baseline was already fully green, so every post-change result below is attributable to the change
only in the sense that nothing regressed.

### After the change

```
=== GATE 1: npx tsc --noEmit (root) ===
GATE 1 exit code: 0
```

```
=== GATE 2: npm test ===
  ✔ label round-trip (0.5301ms)
✔ legacy slot strings (14.1252ms)
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2273.5863
GATE 2 pipeline exit: 0
```

```
=== GATE 3: npm --prefix apps/web run lint ===
> ridgeline-web@0.0.0 lint
> tsc --noEmit
GATE 3 exit code: 0
```

| Gate | Command | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` (root, typechecks `apps/web` too) | exit **0**, no diagnostics |
| 2 | `npm test` | **159/159 pass**, 0 fail, 12 suites, exit **0** |
| 3 | `npm --prefix apps/web run lint` | exit **0**, no diagnostics |

Gate 1 is the one that catches a bad relative import in a Next page — it is clean, so the
`../../../components/...` paths and the `CustomersView` prop types both resolve under the root
program (which, per AGENTS.md, has no `include` and typechecks everything together).

---

## 5. Deviations

**None in the artifacts.** Both files are exactly as the brief specifies. Two brief statements
proved factually inaccurate about the source file; in both cases I followed the binding rule
(byte-identical copy / do not redesign) and left the code untouched.

---

## 6. Findings (no action taken — informational for the controller)

1. **Brief line 38 says "Keep its `EmptyState`/`AIIcon` imports (task 3)" — there are none.**
   `src/components/CustomersView.tsx` imports only `lucide-react`, `recharts`, `../types`,
   `../lib/utils`, `../lib/chartUtils` and `./ChartSkeleton`. Its two empty states ("No customers
   found." at `:211` and the "No Customer Selected" panel at `:352-364`) are hand-rolled inline
   markup, not `EmptyState`/`AIIcon` components. Consequence: the `customers: []` empty state on
   this page will not be styled by whatever `EmptyState` renders elsewhere. That is *faithful to
   the Vite app* (so parity is preserved) but it means the two pages will not look identical if
   someone later swaps the Vite view to `EmptyState`. Not my call to change — copying verbatim was
   the instruction.

2. **The brief contradicts itself on the search box, and I resolved it in favor of verbatim copy.**
   Line 38 says "no search/filter feature", but the component *does* have a `useState`-driven
   `searchTerm` filter (`:45`, filter at `:52-56`, the input at `:193-202`) plus a
   `selectedCustomerId` expansion state (`:46`). Copy-rule line 39 explicitly says "If the copy
   contains a `useState`-driven 'selected customer' or filter, keep it exactly as-is", and the
   Vite app ships this search input, so removing it would have broken parity. Left in. The
   "no search/filter feature" phrase in line 38 is best read as "don't *add* one".

3. **`isChartLoading` is a declared prop that the Vite app never passes.** `CustomersViewProps`
   (`:31-37`) has 5 props; `App.tsx:910-916` passes 3. `onSelectCustomer` and `isChartLoading`
   fall back to their defaults (`false`), so the `isLoading || isChartLoading` chart-skeleton
   branch at `:118` is driven by `isLoading` alone — identical to :3000. No provider member is
   needed for it, which is why the 3-prop mapping is complete and correct. Flagging because
   someone auditing "props declared vs props wired" would otherwise see a gap.

4. **"Customer Profiles" renders twice on `/customers` — expected, not a regression.** The
   Header breadcrumb (task 3, `Header.tsx:53-54`) returns `'Customer Profiles'`, and the view's own
   `<h2>` (`:102-105`) is also "Customer Profiles". `src/App.tsx` renders both simultaneously, so
   this is a faithful port of an existing duplicate, and the brief's own verification step
   ("header reads 'Customer Profiles'") is satisfied. Not worth "fixing" in a move-only task;
   noting it so Sentinel doesn't read it as an introduced bug.

5. **The repo working tree was already dirty before this task started.**
   `git status --porcelain` at task start:
   ```
    M server.ts
    M src/components/NewBookingModal.tsx
    M supabase/migrations/20260927000000_init_ridgeline_schema.sql
   ?? apps/
   ?? plans/sprint-4/
   ```
   Those three modifications are **not mine** — I never opened them. The controller should not
   attribute them to task 8 when reviewing. `apps/` and `plans/` are untracked as a whole, so
   per-file diffing inside `apps/` needs `git add -N` or a direct file compare rather than
   `git status`.

---

## 7. Left for the controller's combined runtime sweep

Per the wave rules I booted nothing, so these brief items are unverified and remain for the
controller's single runtime pass on :3001:

- `/customers` renders the list; sidebar highlights Customers; header reads "Customer Profiles".
- Side-by-side parity with :3000: names, phones, addresses, booking counts, revenue figures.
- Recharts area chart renders; loading state shows the tab skeleton.
- Expanding a customer shows booking history with status badges and amounts.
- Empty `customers` array → the component's own empty state.
- No Network requests originate from this page beyond the provider's initial
  `GET /api/neon/data` load (statically assured — neither file contains a `fetch`).

## 8. Handoff

**Commits:** none — the controller commits; the brief assigns commit duties outside my two files'
scope and `apps/` is untracked at wave start.

**No `supabase` subagent dispatched** — this task is presentation-only. No schema, migration, RLS
or grant work was needed, and dispatching it would have violated the file-disjoint rule.
