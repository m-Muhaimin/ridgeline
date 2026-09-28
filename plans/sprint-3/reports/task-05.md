# Task 5 report — MessageSid idempotency

**Status:** done. `npx tsc --noEmit` exits 0, `npm test` passes (155/155, 12 suites, 0 fail).
No commits made. Staged WIP and Task 1–4 outputs untouched (policy-engine, tenant-context,
ai-pipeline, twilio-phone, and the cancel/reschedule reply strings are byte-identical).

## Files changed

| File | Change |
|---|---|
| `packages/application/conversation-service.ts` | `messageSid` input; `duplicate` on the result; dedupe pre-check as the first statement; `twilio_message_sid` on the customer INSERT; 23505 race catch |
| `packages/application/__tests__/conversation-service.test.ts` | new section 7 (3 cases) + one required fix to the existing Task 4 assertion (see Deviations) |
| `supabase/migrations/20260929000000_webhook_idempotency.sql` | **new** — the brief's exact SQL: `idx_sms_messages_twilio_message_sid` + `idx_missed_calls_twilio_call_sid` |
| `server.ts` | `/webhooks/twilio/sms` passes `messageSid: req.body.MessageSid ?? null` (:2201); `initDb()` step-2 index block gains both unique indexes (:2595-2599) |

## Exact result-type change

```ts
// before
export type ProcessInboundSmsResult = { replyText: string };
// after
export type ProcessInboundSmsResult = { replyText: string; duplicate: boolean };
```

Input type gains `messageSid?: string | null;`. The only writer of the new field is
`processInboundSms`: `return { replyText: dup.rows[0].text, duplicate: true }` on both
duplicate paths (:165, :267) and `return { replyText, duplicate: false }` on the normal path.
The webhook keeps its existing normal reply path (`twiml.message(outcome.replyText)`) and does
not branch on `duplicate` — the brief specifies no webhook-side branch, so the flag is carried
on the result for the caller to consume, per the brief.

Statement order on a normal delivery is unchanged except that the customer INSERT now binds a
third parameter: `(thread_id, sender, text, action_tag, twilio_message_sid) VALUES ($1, 'customer',
$2, null, $3)` with `[threadId, body, input.messageSid ?? null]`. Dedupe pre-check runs before
`loadOrgContext`, so a retry issues exactly one statement. `SAVEPOINT sched` booking writes,
the `catch`/`rethrow` for every other insert error, and all cancel/reschedule strings are unchanged.

## How the migration is discovered by `scripts/migrate.ts`

Directory glob, not a hardcoded filename — the new file is picked up with no change to the script:

```ts
const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
```

`20260929000000_webhook_idempotency.sql` sorts after both existing files, and each file is applied
in its own `BEGIN`/`COMMIT` and recorded in `public.schema_migrations`, so re-running skips it:

```ts
for (const file of migrationFiles) {
    const done = await client.query('SELECT 1 FROM public.schema_migrations WHERE filename = $1', [file]);
    if (done.rows.length > 0) { console.log(`Skipping ${file} (already applied)`); continue; }
    ...
}
```

One nuance worth recording: the legacy bootstrap path inserts **only `migrationFiles[0]`**
(`20260927000000_init_ridgeline_schema.sql`) as already applied, so the new file is never
mistaken for the init migration. `20260928000000_scheduling_truth_engine.sql` and the new file are
both applied on the next run. `scripts/migrate.ts` was not modified.

Both index statements exist in **both** required places (verified by grep):

- `server.ts:2596-2599` (inside `initDb()`'s existing index section, `IF NOT EXISTS` so it is
  boot-idempotent, and it lands before step 3's RLS block that already assumes both tables exist)
- `supabase/migrations/20260929000000_webhook_idempotency.sql:6-12`

## Verification

```
npx tsc --noEmit                                  → exit 0, no output
npm test                                          → tests 155, suites 12, pass 155, fail 0
grep twilio_message_sid|twilio_call_sid
  server.ts                                       → 2596-2599 (both indexes)
  supabase/migrations/20260929000000_...sql       → 6-12 (both indexes)
  packages/application/conversation-service.ts    → 159, 249, 262 (dedupe x2 + insert)
grep -n messageSid conversation-service.ts        → 74 (param), 155/161/164 (pre-check read +
                                                     log), 251 (insert param), 258/264 (23505 branch)
```

New tests (all hermetic — no server, DB, network or LLM):

- `a retried delivery replays the cached reply and writes nothing` — fake db keyed on
  `inbound.twilio_message_sid = $1`; asserts `{ replyText: 'Cached assistant reply', duplicate: true }`,
  `db.calls.length === 1`, zero INSERT/UPDATE, and no `assistant_settings` read.
- `a delivery that loses the unique-index race is answered from the cache` — the pre-check and the
  race re-read are the same SQL text, so the fixture counts reads: the first returns no rows, the
  INSERT throws `{ code: '23505' }`, the second returns the cached row; asserts
  `duplicate: true`, 2 reads, and that neither the assistant INSERT nor the thread UPDATE ran.
- `the customer message records the MessageSid, or a null when it has none` — asserts the recorded
  params of the customer INSERT are `[THREAD, body, 'SM123']` when provided and `[THREAD, body, null]`
  when omitted, that the no-sid path issues no dedupe read at all, and that the normal path returns
  `duplicate: false`.

## Deviations (smallest fix only)

1. **`conversation-service.test.ts` — one existing assertion had to change.** Task 4's test
   `'an inquiry is answered and stored, and nothing is booked'` asserted
   `/INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag\)/` for the customer
   message. That regex requires a closing paren right after `action_tag`, so it stopped matching the
   moment the brief's insert gained the `twilio_message_sid` column, and the old test would fail.
   Changed to `...action_tag, twilio_message_sid\)` — one regex, same intent. No other Task 4
   assertion was touched.
2. **`initDb()` placement.** The brief said "find the existing indexes section and append". The only
   index block in `initDb()` is the tail of step 2 (`idx_customers_*`, `idx_users_*`, server.ts:2592),
   so the two unique indexes were appended there under the brief's own comment, with the brief's
   exact two-statement text. `initDb()` does not create `sms_messages`/`missed_calls` (the init
   migration does); it already `ALTER TABLE`s both in step 3, so referencing them in step 2 does not
   introduce a new precondition. Line-wrapping differs from the `.sql` file because the brief gives
   two different renderings of the same two statements; the SQL is otherwise identical.
3. No new npm scripts, no `scripts/migrate.ts` change, no edits to `src/`, `dist/`, or Task 1–4 files.

## Concerns for Sentinel / Probe

- **The 23505 branch is not reachable in production Postgres as written.** The brief's catch
  re-issues the dedupe SELECT after the unique violation, but the customer INSERT has no savepoint
  around it and `runTenantQuery` runs the whole conversation in one transaction
  (`tenant-context.ts:19-31`). A 23505 aborts that transaction, so the follow-up SELECT and the
  COMMIT fail (25P02 → `ROLLBACK`, error propagates → the webhook answers Twilio with error TwiML).
  Implemented literally as the brief specifies; the pre-check, not the race branch, is what
  actually prevents a double send. If the race path is meant to work, it needs a `SAVEPOINT` around
  the customer INSERT (the same pattern `SAVEPOINT sched` already uses for bookings) — a design
  change, so it is raised here rather than made. Probe should assert the pre-check is the *first*
  statement, which is what makes the guarantee hold.
- **Dedupe read has no organization predicate.** It joins on `thread_id` and filters
  `twilio_message_sid`, so it relies on `twilio_message_sid` being globally unique (the partial
  index) and on RLS for tenant scoping. Correct today; a scope change later would need
  `app.current_organization_id()` in the predicate. Same for the `missed_calls` index Task 6
  consumes — a NULL `twilio_call_sid` is excluded by the predicate, so API-originated rows cannot
  collide.
- **Probe should test:** repeated delivery of the same `MessageSid` produces one assistant message
  and one booking; a delivery with no `MessageSid` is unaffected; and
  `npx tsx scripts/migrate.ts` applies `20260929000000_webhook_idempotency.sql` and then reports
  `Skipping` on a second run.
