# Task 7 report — voice-status webhook tenant-aware

## Files changed

- `server.ts` — **only** the `if (pool) { ... }` DB branch of `/webhooks/twilio/voice-status`
  (lines 2393-2443). Everything else in the handler is byte-for-byte unchanged.

No new files. The brief lists only `server.ts` under **Files** and gives no test section, so
there is nothing to add to the suite — this task is server-only. No commits made.

## What changed

The Task 6 persist block (four raw `pool.query` calls) is replaced by the brief's exact
`runTenantQuery` wrapper. Net effect: **one** `pool.connect()`, one txn, six `client.query`
statements — the in-txn dedupe re-check, the `missed_calls` INSERT, the `sms_threads` lookup,
the `sms_threads` INSERT-or-UPDATE, and the `sms_messages` INSERT.

## Final handler flow (`/webhooks/twilio/voice-status`, lines 2343-2464)

1. `dialStatus !== 'completed'` gate — completed calls return early (2349-2350).
2. `findOrgByTwilioNumber(to)`; unknown org → warn + empty `<Response/>` (2352-2356).
3. `callSid = DialCallSid || CallSid || ''`, `techName`, `bizName`, `autoSms` (2358-2362).
4. **Task 6 pre-send dedupe guard — kept byte-for-byte (2364-2382).** Raw
   `pool.query(... WHERE twilio_call_sid = $1 LIMIT 1)` when `pool`, else
   `inMemoryCalls.some(...)`. On duplicate: warn + early return, **no SMS sent**.
5. `twilioClient.messages.create(...)` (2384-2391) — inside the guard, **outside** any txn.
6. `if (pool)` → `runTenantQuery(pool, orgId, null, async (client) => {...})` (2394-2443):
   - in-txn dedupe re-check, same predicate; on hit → warn + `return` from the callback
     (read-only txn, outer COMMIT is a no-op, no writes, and crucially no second textback —
     the send already happened above or not at all);
   - `INSERT public.missed_calls` (org_id, 'Caller', from, duration || 15, auto_sms_sent=true,
     auto_sms_sent_at=NOW(), converted=false, twilio_call_sid = callSid || null);
   - `SELECT public.sms_threads WHERE organization_id=$1 AND customer_phone=$2 LIMIT 1`;
     miss → `crypto.randomUUID ? crypto.randomUUID() : toUuid('mc-th-…')` + INSERT
     (trade_type = `org.trade || 'plumbing'`, status `'active'`, last_activity_at NOW());
     hit → reuse `rows[0].id` + `UPDATE … last_activity_at = NOW()`;
   - `INSERT public.sms_messages (thread_id, 'assistant', autoSms, 'slot_offered')`.
7. `else` → `inMemoryCalls.unshift({...})` unchanged (2444-2457).
8. `catch` → `console.error('Error handling missed call textback:', e)`; handler still
   returns an empty `<Response/>` (200) so Twilio does not retry-loop (2458-2464).

All five statements now execute as `ridgeline_app` with
`app.current_organization_id = orgId` set, so RLS actually applies to the missed-call row, the
SMS thread, and the SMS message. Before this task they ran as the raw connection role, which
bypassed RLS entirely — and an INSERT with no `set_config` context is exactly the shape that
gets silently filtered or cross-tenant-leaked depending on policy.

## Controller ruling — both dedupe paths are kept (documented, intentional drift)

The brief is self-contradictory: it says the in-txn re-check is "the single source of truth…
do not keep both (two code paths that must agree is drift)", but also that the Task 6 pre-send
guard "remains the primary protection" and that `twilioClient.messages.create` stays inside the
guard and outside the transaction. Per the controller's final ruling:

- **Task 6 pre-send guard: kept byte-for-byte.** It is the only thing standing between a
  retried Twilio callback and a second irreversible outbound SMS. The in-txn re-check runs
  *after* the send, so it cannot prevent a duplicate textback — it can only prevent a
  duplicate DB row. Deleting the pre-send guard would trade a "two paths must agree" smell for
  a real customer-facing defect (double textback).
- **In-txn re-check: added exactly as the brief's snippet shows.** It closes the window where
  two callbacks for the same CallSid both pass the pre-send check before either INSERT commits.

The two paths are the same predicate (`WHERE twilio_call_sid = $1 LIMIT 1`) on the same
column, differing only in scope (raw pool vs. tenant txn) and timing (pre-send vs. pre-write),
so they cannot semantically disagree — the worst case is the second one being redundant. The
invariant is additionally enforced at the database level by the unique index on
`twilio_call_sid` from Task 6's migration, so a genuine race surfaces as a constraint
violation inside the txn (which `runTenantQuery` rolls back) rather than a duplicate row.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npm test` | **155 tests, 155 pass, 0 fail, 12 suites** (duration 1512 ms) |
| No `pool.query` in the voice-status *persist* block | confirmed — the only raw `pool.query` left in the handler is the pre-send guard at 2370 |
| No `pool.query` in `/webhooks/twilio/sms` (2178-2318) | confirmed — zero |
| Dedupe re-check + all INSERT/UPDATE are `client.query` in one `runTenantQuery` | confirmed — `runTenantQuery` at 2395; `client.query` at 2399 (re-check), 2409 (missed_calls INSERT), 2418 (thread SELECT), 2426 (thread INSERT), 2434 (thread UPDATE), 2438 (sms_messages INSERT) |
| Pre-send guard + `twilioClient.messages.create` unchanged | confirmed by reading 2364-2391 against the pre-edit state; the diff is confined to lines 2393-2443 |
| Staged WIP / Task 1-6 outputs untouched | confirmed — `git status` shows the same staged set as before; only `server.ts` was written |

### Full `grep -n "pool.query" server.ts` site list (30 sites, with owner)

| Line | Owner | Category |
|---|---|---|
| 503, 512, 515 | `requireAuth` | auth (user lookup / org backfill) |
| 567, 573, 582, 589 | `/api/auth/register` | auth route |
| 695, 711, 724, 727 | `/api/auth/login` | auth route |
| 839 | `/api/auth/me` | auth route |
| 1025, 1033, 1036, 1039, 1042, 1045, 1048, 1051, 1054 | `/api/neon/status` | dev/status |
| 2057, 2061 | `/api/organizations/switch` | org switch |
| 2092 | `findOrgByTwilioNumber` | org resolution |
| **2370** | **`/webhooks/twilio/voice-status` — Task 6 pre-send dedupe guard** | **kept by controller ruling** |
| 2529, 2532 | `/api/missed-call/process` (simulate modal; never mounted, no live client) | dev seed |
| 2570, 2602, 2639, 2669 | `initDb` | boot DDL |

Expected per brief: requireAuth, auth routes, `findOrgByTwilioNumber`, `/api/neon/execute-sql`,
`/api/neon/status`. Observed additionally, all pre-existing and out of scope for this task:
`/api/organizations/switch` (2), `/api/missed-call/process` (2), `initDb` (4).
`/api/neon/execute-sql` runs caller-supplied SQL through the pool by design and has no
`pool.query` text match of its own. The `findOrgByTwilioNumber` site is deliberate: org
resolution must happen *before* any tenant context can exist.

The one entry the brief's verification line wanted gone — **2370** — is retained because the
controller ruled the pre-send guard byte-for-byte-preserved and final. Sprint item 3.2 is
therefore closed for the persist path, not for the pre-send read.

## Deviations from the brief

1. **Both dedupe paths kept** (pre-send at 2364-2382 + in-txn at 2396-2407) instead of the
   brief's "delete the pre-send dedupe". Reason: controller ruling, final — the pre-send guard
   is the only protection against a duplicate irreversible textback, and the in-txn re-check
   runs after the send. The "do not keep both" instruction is the brief's own self-conflict,
   explicitly overridden.
2. **No test file added.** The brief has no test section and names only `server.ts`; adding one
   would require extracting the handler from `server.ts` to import it (it is registered as a
   side effect of the monolith), which is beyond this task's stated scope.

## Sentinel / Probe notes

- **Sentinel:** the duplicate predicate appears twice (2371 and 2400). Confirm both read the
  same column and that the Task 6 unique index on `missed_calls.twilio_call_sid` still exists —
  it is what turns a true two-callback race into a rolled-back txn instead of a duplicate row.
  Also confirm `initDb` still creates that index: it re-DDLs on every boot and can revert a
  hand-added index.
- **Probe:** with a real `DATABASE_URL`, replay the same `DialCallSid` twice and assert
  (a) exactly one `missed_calls` row, (b) exactly one outbound SMS, (c) the second callback
  still returns HTTP 200 with `<Response/>` so Twilio stops retrying. Then run the handler as an
  org whose RLS context is set and confirm the `sms_threads` / `sms_messages` rows land in that
  org only — the pre-task code would have bypassed RLS for all five statements.
- **Probe:** force the `SET LOCAL ROLE ridgeline_app` to fail (role not provisioned). It is
  swallowed by `runTenantQuery`, so the txn proceeds as the raw role — the same silent
  degradation as before this task, now at least inside a txn.
