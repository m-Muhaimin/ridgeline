# Task 1 — Extract `runTenantQuery` (Sprint 2, item 2.5) — Report

**Status: COMPLETE.** All three verification gates pass. No deviations from the brief.

---

## Files changed

| File | Change |
|---|---|
| `packages/application/tenant-context.ts` | **Created** — exact code from brief (lines 20-58). Exports `Queryable`, `PoolClientLike`, `Connectable`, `runTenantQuery`. |
| `packages/application/__tests__/tenant-context.test.ts` | **Created** — 4 test cases per brief, `node:test` + `node:assert/strict`, fake `Connectable`/`PoolClientLike`, no server/DB/network. |
| `server.ts` | **Edited** — 3 hunks: import fixed, new import added, local helper deleted, 13 call sites rewritten. |

`server.ts` unstaged diff is exactly 15 insertions / 46 deletions across 16 hunks:
- `@@ -3,7` — `import { Pool, PoolClient }` → `import { Pool }` (`PoolClient` was used *only* in the deleted signature at old line 519; grep-verified no other use).
- `@@ -33,6` — added `import { runTenantQuery } from './packages/application/tenant-context.js';`
- `@@ -512,38` — deleted the local `runTenantQuery` (old lines 515-545, incl. its two explanatory comments which the brief's replacement block does not carry).
- 13 × one-word hunks — `runTenantQuery(orgId, userId, …)` → `runTenantQuery(pool, orgId, userId, …)`.

No local `type Queryable` alias existed in `server.ts` (that alias lives in `packages/application/booking-service.ts` and is unrelated/untouched). Grep for `type Queryable|PoolClient` in `server.ts` now returns nothing.

## Call sites converted: 13 of 13

Every `runTenantQuery(` occurrence in `server.ts` is now the pool-first form. Matched the brief's line list 1:1 (drifted by the import/helper deletions, as expected):

| Brief line | Now | Route |
|---|---|---|
| 1033 | 1002 | `POST /api/auth/complete-onboarding` |
| 1243 | 1212 | `GET /api/neon/data` |
| 1447 | 1416 | `GET /api/customers` |
| 1473 | 1442 | `POST /api/customers` |
| 1528 | 1497 | `PATCH /api/customers/:id` |
| 1564 | 1533 | `DELETE /api/customers/:id` |
| 1674 | 1643 | `POST /api/bookings` |
| 1814 | 1783 | `PATCH /api/bookings/:id` |
| 1888 | 1857 | `POST /api/sms/message` |
| 1992 | 1961 | `PATCH /api/organizations` |
| 2072 | 2041 | `PATCH /api/assistant-settings` |
| 2129 | 2098 | `POST /api/services` |
| 2166 | 2135 | `DELETE /api/services/:id` |

All 13 `if (pool) { … }` guards left byte-identical; `Pool | null` satisfies `Connectable` structurally, no cast.

## Verification

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npm test
ℹ tests 112   (108 pre-existing + 4 new)
ℹ suites 12
ℹ pass  112
ℹ fail  0
ℹ cancelled 0 / skipped 0 / todo 0
```
Baseline before this task was the same 108 tests passing, so nothing regressed. New suite:
```
✔ happy path: BEGIN, org, user, role, callback, COMMIT, release once
✔ null userId: no app.current_user_id set_config is issued
✔ callback throws: ROLLBACK, rethrow, release still called
✔ SET LOCAL ROLE failure is tolerated and the transaction still commits
```

```
$ grep -n "runTenantQuery(" server.ts
  → 13 lines, all `runTenantQuery(pool, orgId, userId, async (client) => {`
  → grep -c "runTenantQuery(pool, " = 13
  → filtering out the pool-first form leaves 0 lines  (no old-form calls)
```

## Behavior equivalence (the one thing worth recording)

The old helper opened with `if (!pool) throw new Error('Database connection pool is not configured');`.
The brief's replacement block has no such statement, and the module cannot have one — it is pool-agnostic
by design, taking a `Connectable` port. **Verified dead at every call site**: all 13 calls sit inside an
`if (pool) { … }` guard (the guard is always the enclosing block, at 8-space or 4-space nesting), so pool is
non-null on every reachable path and the throw could never fire. Behavior is therefore identical, and the
brief's exact code was written as specified.

Same check for the other delta: the deleted helper's two inline comments (`// Set tenant session
configuration for RLS policies`, `// Switch to ridgeline_app tenant role so RLS is actively enforced`) are
documentation, not behavior; the brief's block carries only the role-try/catch comment, which is retained.

**Brief annotation drift (no action taken):** the brief lists the 13th call site as
`organizations/switch`. That route (server.ts:2149-2168) uses bare `pool.query(...)` inside `if (pool)` and
never called `runTenantQuery`. The 13 *line numbers* in the brief are all correct and were all found; only
that route name is off. `grep -n "runTenantQuery("` before the change returned 14 matches (1 definition +
13 calls), which confirms 13 was the correct total.

## Repo state hygiene

- Staged index **untouched** — `git diff --cached --stat` is byte-identical to before
  (`__pycache__/.patch.cpython-312.pyc`, `policy-engine.test.ts`, `policy-engine.ts`, `server.ts` | 23 +/-).
- The staged cancel/reschedule region in `server.ts` (~2775-2842) was **not** touched; the unstaged diff
  contains no hunk anywhere near it.
- Nothing staged, nothing committed. New files are untracked (`??`). Per the brief, I did not `git add`.
- ESM `.js` specifier used on the new import, per repo convention.

## For Sentinel / Probe

- **Probe:** the 13 rewritten call sites are covered by no test (they are inside Express route handlers in a
  monolith). The helper's semantics are proven by the new fake-db suite, but route-level wiring is only
  observable against a live `DATABASE_URL`. `GET /api/neon/status` + the boot log is the tell for whether
  `pool` is real or the in-memory fallback is serving — see the silent-fallback table in AGENTS.md.
- **Sentinel:** worth a look that no future route calls `runTenantQuery` without a surrounding `if (pool)`
  guard. That guard is now the *only* null check, and the module will not throw a friendly error on a null
  pool — with `strictNullChecks` off in `tsconfig.json`, `Pool | null` typechecks as `Connectable`, so an
  unguarded future call site is a runtime `TypeError` rather than a compile error. A `if (!pool)` guard in
  the new route (or `strictNullChecks`) closes that.
- Tasks 4 and 7 (per the brief's "Where it fits") can now call
  `runTenantQuery(pool, org.id, null, …)` in the webhook handlers — note those handlers are *not* inside an
  `if (pool)` block today, so they will need their own guard.

## Deviations from the brief

**None.**
