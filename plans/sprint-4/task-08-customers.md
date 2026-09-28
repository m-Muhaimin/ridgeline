# Task 8 — Customers page (`/customers`)

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §3 row 8. Port of `src/App.tsx:909-917`.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Data comes **only** from `useData()` (task 3's contract). This page makes **no** API calls — it is pure presentation.
3. Ported code is a move, not a redesign: class names, copy, layout, component internals copied verbatim.
4. No `'use client'` inside `apps/web/components/**`; the page itself starts with `'use client'`.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint`.
6. **File-disjoint:** this task owns only the two files listed below. Never edit task 3's shell/provider, task 2's `lib/`, or task 4's `ChartSkeleton.tsx`.

## Goal
Stand up `/customers` rendering `CustomersView` — the customer list, per-customer booking history, and the revenue area chart — with the exact props the Vite app passes today. This is the smallest page in the sprint; do not add to it.

## Files (all **Create**)
| File | Source |
|---|---|
| `apps/web/components/CustomersView.tsx` | copy of `src/components/CustomersView.tsx` (369 lines, **verbatim**) |
| `apps/web/app/(dashboard)/customers/page.tsx` | port of `App.tsx:910-916` |

`CustomersView` imports `{ TabChartSkeleton }` from `./ChartSkeleton` — that file is **task 4's copy**; import it, do not create a second one.

## `app/(dashboard)/customers/page.tsx` — the whole file
```tsx
'use client';
import { useData } from '../../../components/DataProvider';
import { CustomersView } from '../../../components/CustomersView';

export default function CustomersPage() {
  const { customers, bookings, isDataLoading } = useData();
  return <CustomersView customers={customers} bookings={bookings} isLoading={isDataLoading} />;
}
```
That is the complete `App.tsx:911-915` mapping, one-to-one. No page-level wrapper, no header row, no search box, no extra cards — `<main>` padding and max-width come from `DashboardShell`, exactly as in the Vite app.

## Copy rules
- `CustomersView.tsx`: byte-identical. Keep its `EmptyState`/`AIIcon` imports (task 3), `../types` and `../lib/chartUtils` (task 2), its recharts `AreaChart`, its `useMemo` derived revenue totals, its per-customer history expansion, and its empty state. No prop additions, no renames, no search/filter feature.
- If the copy contains a `useState`-driven "selected customer" or filter, keep it exactly as-is.

## What must NOT change
No styling edits, no new columns, no CSV export, no avatar initials changes, no date formatting changes. The component is read-only w.r.t. the API in the current app — the customers list is hydrated by the provider's single `GET /api/neon/data`.

## Verification
```bash
npx tsc --noEmit && npm test && npm --prefix apps/web run lint
```
Browser, logged in on :3001:
- `/customers` renders the customer list; sidebar highlights Customers; header reads "Customer Profiles". Compare side by side with :3000 — names, phones, addresses, booking counts and revenue figures must match.
- The revenue area chart renders; the loading state shows the tab skeleton.
- Expanding a customer shows their booking history with status badges and amounts.
- With an empty `customers` array the component's own empty state renders (verify by switching to an org with no customers, or by reading the markup — do not add a test hook).
- No Network requests originate from this page (all data arrived via the provider's initial load).

## Non-goals
No provider changes, no API calls, no `CustomersView` edits, no styling changes, no new features. Do not touch task 4's `ChartSkeleton.tsx` or task 9's settings files.

## Where it fits
One of the five file-disjoint page tasks (4–9) that run in parallel on top of the frozen task-3 shell + `useData()` contract. Cross-task reads only: task 4's `ChartSkeleton.tsx`.
