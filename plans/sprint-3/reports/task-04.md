# Task 4 — Extract the SMS conversation service — Report

**Status:** complete. `npx tsc --noEmit` exits 0; `npm test` → 152/152 pass (14 of them new).
**Commits:** none (working tree only, as instructed). `git log` head is still `7bee927`.

---

## 1. Files changed

| File | Change |
|---|---|
| `packages/application/id-utils.ts` | **new** — `toUuid` moved out of `server.ts`, body verbatim |
| `packages/application/conversation-service.ts` | **new** — `processInboundSms`, `loadOrgContext`, ports |
| `packages/application/__tests__/conversation-service.test.ts` | **new** — 14 hermetic cases |
| `server.ts` | 155 insertions / 737 deletions (working tree vs. index) — `toUuid` + `getOrgContext` deleted, SMS webhook rewritten, imports pruned |

Untouched (verified: `git diff --stat` on these paths is empty, and the index copy of `server.ts`
still contains the WIP string):
`packages/application/tenant-context.ts`, `packages/application/ai-pipeline.ts` (+ its test),
`packages/domain/organizations/twilio-phone.ts` (+ its test),
`packages/domain/conversations/policy-engine.ts` (+ its staged test).

`server.ts` line endings are unchanged (LF, 2741 lines, was 3323 — the 582-line drop is the moved
code; the index snapshot is still intact for `git diff --cached`).

---

## 2. Exported surface

`packages/application/id-utils.ts`
```ts
export function toUuid(input: string): string
```

`packages/application/conversation-service.ts`
```ts
export type OrgForConversation   = { id, name, trade?, technician_name?, technicianName? }
export type LoadedOrgContext     = { settings: any; services: any[]; bookings: any[] }
export type SmsResponder         = (options: RunSmsAssistantOptions, deps: { gemini: GoogleGenAI | null }) => Promise<SmsAssistantResult>
export type ProcessInboundSmsInput  = { db: Queryable; org; from; string; to: string; body; gemini; responder? }
export type ProcessInboundSmsResult = { replyText: string }

export async function loadOrgContext(db: Queryable, orgId: string): Promise<LoadedOrgContext>
export async function processInboundSms(input: ProcessInboundSmsInput): Promise<ProcessInboundSmsResult>
```

`server.ts` now imports exactly one of them (`processInboundSms`); `loadOrgContext` and
`OrgForConversation` remain exported for the next caller — see deviation **D5**.

---

## 3. How the staged WIP block was moved

The staged persist-and-book block (`server.ts` 2338–2484, including the cancel/reschedule WIP) was
moved **verbatim** into step 5 of `processInboundSms`, with only the substitutions the brief lists.
Proven mechanically: I extracted the pre-change block from the index snapshot and diffed it against
the service region, normalising whitespace and applying `client.query → db.query`. 146 lines on each
side, and the complete diff is:

```
-if (pool) {
-const client = await pool.connect();
-try {
-await db.query('BEGIN');
 await db.query(                                   <- customer message INSERT
...
-policy = await loadSchedulingPolicy(client, orgId);
+policy = await loadSchedulingPolicy(db, orgId);
-const resolution = await resolveRequestedSlot(client,
+const resolution = await resolveRequestedSlot(db,
-const cancelled = await cancelThreadBookings(client, orgId, threadId);
+const cancelled = await cancelThreadBookings(db, orgId, threadId);
 if (moved > 0) threadStatus = 'rescheduled';        <- unchanged
-const booking = await createBookingChecked(client, orgId, {
+const booking = await createBookingChecked(db, orgId, {
+// (4 added comment lines explaining the rethrow — no code change)
```

So the *only* code deltas are: the removed `if (pool) {` / `pool.connect()` / `try {` / `'BEGIN'`
wrapper, the `client → db` rename in five booking-service calls, and one comment. Everything else is
byte-identical — the savepoint trio, the decision wiring, and every reply string. The two strings the
controller named:

* `conversation-service.ts:290-291` — the copy now reads
  ```ts
            threadStatus = 'booked';
            replyText =
              'That visit is already under way, so I was not able to cancel it. Reply here and the office will sort it out with you.';
  ```
  with its `cancelled > 0` / `else` conditions and `console.warn` intact.
* `conversation-service.ts:296` — `if (moved > 0) threadStatus = 'rescheduled';`

Both are gone from `server.ts` (`grep -c "already under way" server.ts` → 0) and present in the new
location. Transaction control in the service: `SAVEPOINT sched` (274), `RELEASE SAVEPOINT sched`
(317), `ROLLBACK TO SAVEPOINT sched` (319) — and **no** `BEGIN` / `COMMIT` / `ROLLBACK` /
`connect` / `release` (grep-verified). The caller's `runTenantQuery` owns the boundary.

---

## 4. Persist-error policy

Implemented exactly as the brief specifies, in the moved block's inner catch
(`conversation-service.ts:318-334`):

```ts
} catch (bookingErr: any) {
  await db.query('ROLLBACK TO SAVEPOINT sched');
  const recoverable =
    bookingErr instanceof SlotUnavailableError ||
    bookingErr instanceof UnparseableSlotError ||
    bookingErr?.code === '23P01';
  if (!recoverable) throw bookingErr;
  console.error('SMS booking rejected:', bookingErr.message);
  bookingId = null;
  threadStatus = 'active';
  replyText = SLOT_UNAVAILABLE_REPLY;
}
```

* **recoverable** → `ROLLBACK TO SAVEPOINT sched` absorbs the constraint violation, the customer gets
  `SLOT_UNAVAILABLE_REPLY`, the thread is reset to `active`, no `booking_id` is written, and the
  conversation still commits.
* **anything else** → rethrown out of the service, `runTenantQuery` issues `ROLLBACK` for the whole
  exchange, and the webhook's outer `catch` answers with the generic error TwiML. Previously such an
  error was logged, rolled back and swallowed while a TwiML reply was still sent.

Note: the *staged* tree already contained this `if (!recoverable) throw bookingErr;` — the brief's
item (d) and the WIP agreed, so nothing had to be reconciled. I added four comment lines only.

---

## 5. `server.ts` — the webhook rewrite

`server.ts:2192-2205` is the whole database path now:

```ts
    const orgId = org.id;

    if (pool) {
      // One tenant-scoped transaction for the whole conversation: context load,
      // customer/thread lookup, the assistant, and the persist-and-book writes.
      // The service issues no BEGIN/COMMIT of its own -- the caller's
      // runTenantQuery owns that -- so a reply can only be returned for state
      // that actually committed.
      const outcome = await runTenantQuery(pool, orgId, null, (client) =>
        processInboundSms({ db: client, org, from, to, body, gemini: ai }));
      const twiml = new MessagingResponse();
      twiml.message(outcome.replyText);
      return res.type('text/xml').send(twiml.toString());
    }
```

* The offline-reply early branch (`server.ts:2184-2190`) is untouched, including Task 2's copy.
* The no-`DATABASE_URL` branch continues at 2207 with `getInMemoryOrgContext(orgId)`, then the
  in-memory customer/thread/history, `runSmsAssistant({...}, { gemini: ai })`, both message pushes and
  the in-memory booking push — all transcribed unchanged, including `localDateInZone`,
  `stripDayQualifier` and the "no availability source" comment. Its reply is still
  `assistantResult.replyText` (`server.ts:2308`).
* `grep -n "pool.query"` over the handler body (2178–2316) returns **nothing**; its DB work is all
  `client.query` inside `runTenantQuery`.
* `getOrgContext` → `getInMemoryOrgContext` (`server.ts:2123-2131`), keeping the non-optional
  `inMemoryOrgs[0].id` the brief allowed.
* Pruned imports that the move made dead: `assertSlotAvailable`, `cancelThreadBookings`,
  `composeOfferReply`, `rescheduleThreadBookings`, `resolveRequestedSlot`, `resolveServiceDuration`,
  `withinBusinessHours`, `timeColumnToMinutes`, `DEFAULT_MAX_ADVANCE_DAYS`, `resolveBookingInterval`,
  `type CreateBookingInput`, `type ResolvedSlot`, `type SchedulingPolicy`, and the whole
  `policy-engine` import. `SlotUnavailableError` / `UnparseableSlotError` / `createBookingChecked` /
  `loadBusyIntervals` / `loadSchedulingPolicy` / `localDateInZone` / `proposeAvailableSlots` /
  `DEFAULT_SERVICE_MINUTES` / `SLOT_STEP_MINUTES` / `type SlotOffer` / `runSmsAssistant` /
  `DEFAULT_OPENAI_*` all still have other callers and stay.

---

## 6. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 152 tests, 152 pass, 0 fail (14 new) |
| `grep -n "processInboundSms" server.ts` | 38 (import) + 2201 (one call site) |
| `grep -rn "already under way"` | `conversation-service.ts:291` + its test at 253/257 |
| `grep -rn "threadStatus = 'rescheduled'"` | `conversation-service.ts:296` |
| `pool.query` in the handler | none |
| `BEGIN`/`COMMIT`/`ROLLBACK`/`connect` in the service | none (savepoints only) |
| staged WIP block diff vs. service | 5 `client→db` renames + removed connect/BEGIN wrapper, nothing else |
| do-not-touch files | no unstaged diff; index snapshot of `server.ts` intact |
| committed anything | no |

Test coverage (all hermetic — fake `Queryable` recording every `client.query`, stub responder, no
server/DB/network/LLM):

1. `an inquiry is answered and stored, and nothing is booked` — brief case 1, incl. the
   no-`BEGIN`/`COMMIT`/`ROLLBACK`/`connect` assertion
2. `an existing thread is reused and its history reaches the assistant` — brief case 2
3. `an unknown customer gets a thread opened for the conversation` — thread-id fallback path
4. `a stated, verified slot is booked and the thread points at it` — booking persist, `booking_id`
   UPDATE, `RELEASE SAVEPOINT`
5. `a slot that collides gets the taken-slot reply instead of an error` — recoverable, asserts
   `ROLLBACK TO SAVEPOINT` + the answer still stored
6. `the same recovery applies to the raw exclusion-constraint violation` — `code === '23P01'`
7. `a cancellable visit is cancelled…` — brief case 3
8. `a visit already under way is not cancelled, and the thread stays booked` — brief case 4
9. `a cancellation is refused when the organization requires a human` — cancel gated on policy
10. `a cancellation with nothing on the schedule changes no rows`
11. `a verified move reschedules the thread booking` — reschedule, `threadStatus = 'rescheduled'`
12. `a move with no booking on file moves nothing`
13. `an emergency with no verified opening is escalated, never booked` — asserts the
    `[policy] propose_slot: emergency: no verified opening` log line and no write
14. `a recoverable booking failure is answered; any other failure is raised` — brief case 5,
    `assert.rejects` on `{ code: 'XX000' }` at the assistant INSERT

---

## 7. Deviations from the brief (all deliberate, smallest possible fix)

**D1 — Offline-reply string: staged tree wins.** The brief's rewrite snippet carries the pre-Task-2
copy `'RidgeLine Dispatch: Service currently offline for this number.'`. `server.ts` (Task 2,
staged/committed) has `'RidgeLine Dispatch: this number is not currently connected to a dispatch
line. Please try again later.'`. Kept the tree's version verbatim (`server.ts:2188`).

**D2 — The reply actually sent on the DB path changed (behavior change, brief-mandated).** Before:
the TwiML always carried `assistantResult.replyText`, even when the block had overwritten `replyText`
with the cancel confirmation, the "already under way" reply or `SLOT_UNAVAILABLE_REPLY` — i.e. the
staged code *computed and stored* the right answer and then sent the wrong one. After: the webhook
sends `outcome.replyText`. This is what the brief specifies (`return { replyText }` +
`twiml.message(outcome.replyText)`) and its own test cases 3/4 assert it. The in-memory path still
replies with `assistantResult.replyText`, exactly as today. **Customer-visible change** — see §8.

**D3 — `loadOrgContext`'s catch tail.** The old DB branch's `try { … } catch { console.warn }` fell
through to the in-memory store, which the service cannot reach. Substituted
`return { settings: {}, services: [], bookings: [] }`, which is what a real (non-preview)
organization got from that fallback anyway — the in-memory store is keyed by the preview org id.
Kept deliberately: dropping the catch instead would have added a *third* behavior change the brief
does not list. Everything else in the branch is verbatim, `pool.query → db.query`.

**D4 — Tests script `rows.length`, not `rowCount`.** The brief's cases 3/4 say "cancel UPDATE
returns `rowCount: N`". `cancelThreadBookings` returns `res.rows?.length || 0` — nothing in
`booking-service.ts` reads `rowCount` anywhere. The brief told me to check, so the fixtures return
rows (`[{ id: 'bk-1' }]` / `[]`). No fake `rowCount` support was needed.

**D5 — `server.ts` imports only `processInboundSms`.** The brief's import line also names
`loadOrgContext` and `type OrgForConversation`; after the rewrite neither is referenced in
`server.ts`, and importing them would be dead code. Both remain exported from the service.

**D6 — `toUuid` signature narrowed per the brief.** Declared `toUuid(input: string): string` (was
`input?: any`); the `if (!input)` guard is retained. All four surviving callers pass `any`
(`req.params.id`, `req.body.smsThreadId`, `req.body.threadId`) so this compiles. `isValidUuid` is
duplicated as a module-local in `id-utils.ts` — not exported — because `toUuid`'s body is moved
verbatim and `server.ts` still needs `isValidUuid` in four other routes.

**D7 — Extra fixture rows the brief's "minimal" script list omits.** Any non-`inquiry` intent makes
`resolveRequestedSlot`/`proposeAvailableSlots` issue `SELECT o.timezone` (policy) and
`SELECT b.id, b.scheduled_start, …` (busy). Without them the cancel/reschedule/emergency cases cannot
run at all, so both are scripted (`policyRow`, empty busy list).

**D8 — Extra test cases.** The brief names 5; the controller's summary asks for booking persist,
reschedule, emergency escalation, the recoverable-vs-rethrow pair and thread/message writes. Cases
1–5 of the brief are all present verbatim in intent; the rest are additive. On "reminder": there is
no reminder in the moved block — the nearest analogue (the assistant message carrying
`action_tag`/`parsed_intent`, the thread status UPDATE, and the `booking_id` UPDATE) is asserted in
cases 1 and 4.

**D9 — No explicit `responder` at the server.ts call site.** The brief's exact snippet omits it; the
service default `input.responder ?? ((o, d) => runSmsAssistant(o, d))` binds the seam to
`runSmsAssistant` with the `{ gemini: ai }` deps, which is what the controller asked for.

**D10 — `to` is in `ProcessInboundSmsInput` but unread.** The moved DB path never used it (org
resolution happens in the webhook). Kept because the brief's input type includes it and Task 5
(MessageSid idempotency) builds on this input.

**D11 — `Promise.all` of three context queries on one client.** Transcribed verbatim as instructed.
`pg` serializes them on a single client, so this is safe, just sequential. Previously they ran on
three separate pool connections.

---

## 8. For Sentinel / Probe

* **D2 is a customer-visible behavior change**, not a refactor: on the DB path a cancel, a
  "cannot cancel" refusal, a reschedule confirmation, a slot-taken apology, a booking confirmation
  and an offer list are now the text actually delivered, where before the customer received the
  assistant's pre-decision text while the corrected one sat in the database. Probe should walk all six
  replies on a real Twilio sandbox number and compare against `sms_messages`.
* **The LLM call now happens inside the tenant transaction.** "One transaction for the whole
  conversation" is the brief's mandate, but a slow OpenAI-compatible round-trip now holds a
  `pg` connection and an open transaction for its whole duration. Worth a connection-pool sizing
  check and a statement/lock-timeout review; if it bites, the fix is to resolve the slot *before*
  opening the write transaction, which is a design change for a later task, not this one.
* **Non-recoverable persist errors now reach the webhook's `catch`** → generic error TwiML and a full
  rollback. Previously they were logged and swallowed. Test 14 covers the rethrow; Probe should
  confirm the TwiML text `"Sorry, something went wrong on our end — we'll follow up shortly."` for a
  forced mid-write failure.
* `POST /webhooks/twilio/sms` with an unknown `To` must still return the Task 2 offline reply and
  write nothing (the early branch is before the transaction).
* No-`DATABASE_URL` mode must be unchanged: thread created, two messages pushed, in-memory booking
  recorded when a slot is stated.
* Unchanged-but-adjacent: `/api/neon/execute-sql` and `/api/ai/test-endpoint` remain dev-only
  affordances; `twilioFormParser` still precedes the global JSON parser for the webhook.
