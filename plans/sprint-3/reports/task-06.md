# Task 6 report — CallSid idempotency (Sprint 3 item 3.3, CallSid half)

Status: **DONE**, with one documented minimal repair (below) required for the brief's code to compile.

## Files changed

- `server.ts` — **only** the `/webhooks/twilio/voice-status` handler body (`server.ts:2343-2449`),
  plus removal of the now-redundant outer `const callSid` (see Deviations).

No test file was added: the brief's **Files** section lists exactly one edit target
(`server.ts` — the handler body only) and its **Verification** section specifies only
`npx tsc --noEmit`, `npm test`, and a manual `grep`. The brief defines no pure helper to unit-test,
so this task is server-only per deliverable 2's "otherwise the task may be server-only".

Untouched, as required: the staged WIP (`policy-engine.ts` + its test), Task 1-5 outputs
(`tenant-context`, `ai-pipeline`, `twilio-phone`, `conversation-service`, the
`20260929000000_webhook_idempotency.sql` migration, the `initDb()` indexes including
`idx_missed_calls_twilio_call_sid` at `server.ts:2619-2620`), the client contract `src/types.ts`,
and the `/api/neon/data` missed-call read path (`server.ts:1189-1202`, which maps explicit columns
and does not expose `twilio_call_sid` to the client).

No commits were made. `server.ts` was already `MM` (staged Task 1-5 work + unstaged work); my edits
land in the working tree only, leaving the index alone.

## Edits applied (6)

| # | Site | Change |
|---|---|---|
| 1 | `server.ts:2358` | `const callSid = req.body.DialCallSid \|\| req.body.CallSid \|\| '';` — exact brief precedence |
| 2 | `server.ts:2364-2383` | Dedupe guard inserted (exact brief code, see below) |
| 3 | `server.ts:2359` | `techName = org.technician_name \|\| org.technicianName \|\| 'Mark'` (dropped `org?.`) |
| 4 | `server.ts:2360` | `bizName = org.name` — the `'Apex Plumbing & Mechanical'` fallback removed per brief |
| 5 | `server.ts:2396-2401` | `INSERT ... auto_sms_sent_at, converted_to_booking, twilio_call_sid ... false, $5` with `[..., callSid \|\| null]` |
| 6 | `server.ts:2417`, `2438` | `org.trade` (dropped `org?.`); in-memory record gains `twilioCallSid: callSid \|\| undefined` |

## The exact guard code (`server.ts:2364-2383`)

```ts
      // Idempotency: Twilio retries this callback until it gets a 2xx, so a
      // second delivery of the same CallSid must not re-text the customer or
      // duplicate the missed-call record.
      if (callSid) {
        let isDuplicate = false;
        if (pool) {
          const dupRes = await pool.query(
            'SELECT id FROM public.missed_calls WHERE twilio_call_sid = $1 LIMIT 1;',
            [callSid],
          );
          isDuplicate = dupRes.rows.length > 0;
        } else {
          isDuplicate = inMemoryCalls.some(c => c.twilioCallSid === callSid);
        }
        if (isDuplicate) {
          console.warn('Duplicate voice-status callback, skipping missed-call handling:', callSid);
          return res.type('text/xml').send(new VoiceResponse().toString());
        }
      }
```

The log line is the brief's verbatim string. The guard is skipped entirely when `callSid` is falsy
(no `DialCallSid` and no `CallSid` on the callback), which preserves the pre-existing behavior for
malformed deliveries rather than 500-ing them.

## Ordering proof

Within the `try` block, source order proves the dedupe short-circuit precedes both side effects:

```
2358  const callSid = req.body.DialCallSid || req.body.CallSid || '';
2364  // Idempotency: ... guard begins
2368    if (callSid) {
2371      const dupRes = await pool.query('SELECT id FROM public.missed_calls WHERE twilio_call_sid = $1 ...')
2377      isDuplicate = inMemoryCalls.some(c => c.twilioCallSid === callSid);
2379      console.warn('Duplicate voice-status callback, skipping missed-call handling:', callSid);
2381      return res.type('text/xml').send(new VoiceResponse().toString());   <-- RETURNS HERE
2383    }
2385  // Trigger instant outbound SMS via Twilio API if credentials are configured
2386    if (twilioClient) {
2387      await twilioClient.messages.create({ from: to, to: from, body: autoSms })   <-- DB-branch outbound send
2394  // Persist missed call to database or in-memory
2396    await pool.query(`INSERT INTO public.missed_calls (... twilio_call_sid) ...`)  <-- DB persist
2431    inMemoryCalls.unshift({ ..., twilioCallSid: callSid || undefined, ... })         <-- in-memory persist
```

The `return` at 2381 is inside the guard, so a duplicate delivery can reach neither the outbound
`messages.create` (2387) nor either persist branch (2396 / 2431). A duplicate still gets a **2xx**
(empty `VoiceResponse`), which is what stops Twilio from retrying further.

Read independently via `grep -n`: guard `console.warn` 2379 → `messages.create` 2386 →
`INSERT INTO public.missed_calls` 2396. (A second, unrelated `INSERT INTO public.missed_calls` at
2518 belongs to the missed-call simulate path and is out of scope.)

## Verification summary

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npm test` | **155 pass / 0 fail**, 12 suites, 1114 ms |
| `grep -n "twilioCallSid\|DialCallSid" server.ts` | 2358 (callSid source), 2376 (in-memory dedupe read), 2438 (in-memory field) — all 3 expected sites |
| `grep -n "twilio_call_sid" server.ts` | 2371 dedupe query, 2398 INSERT column, 2619-2620 Task 5's index (untouched) |
| Ordering | guard return (2381) < outbound send (2387) < INSERT (2396) — confirmed by reading the handler |

`npx tsc --noEmit` was run **after** the repair below; the first run failed with exactly one error,
now resolved.

Line-count reconciliation: 2747 → 2768 (+21) = +20 guard block, +1 CallSid decl, +1 INSERT column,
+1 in-memory field, −1 removed outer const, with the 2-line TDZ repair at the handler head netting
to +21. This confirms no stray edits landed outside the handler.

## Deviations

### 1. (Required, compile) Removed the outer `const callSid`; Task 2's warn now reads `req.body.CallSid`

The brief says to keep the `dialStatus`/`from`/`to`/`duration` consts, the `!== 'completed'` gate, the
`findOrgByTwilioNumber` resolution, and the Task 2 unknown-org hard-stop "EXACTLY as they are", then
replace the inside of the `try` with a body that opens with its own
`const callSid = req.body.DialCallSid || req.body.CallSid || '';`. Applied literally, the pre-existing
handler-level `const callSid = req.body.CallSid;` collides with it: inside the `try`, the inner
declaration shadows the outer one, and Task 2's warn log sits *above* the inner declaration, so it
reads an uninitialised binding. `npx tsc --noEmit` failed with:

```
server.ts(2355,70): error TS2448: Block-scoped variable 'callSid' used before its declaration.
```

**Minimal repair** (2 lines): deleted the handler-level `const callSid = req.body.CallSid;` and changed
the warn's second argument to `req.body.CallSid`. The logged value is byte-identical to what the
deleted const held, the message string is unchanged, and the hard-stop's semantics (warn + early
empty-`VoiceResponse` return) are untouched. `callSid` is also deliberately absent from the brief's
"keep these consts" list, so removing the redundant outer binding is the intended reading rather than
a design change. The alternative repair — leaving the outer const and shadowing it — would have left a
dead binding whose only remaining consumer is the log.

### 2. (Informational, no code) No in-memory type declaration exists to extend

The brief asks to "add it to the in-memory type declaration (locate via `inMemoryCalls` definition) so
the object literal below typechecks." `inMemoryCalls` is declared `const inMemoryCalls: any[]`
(`server.ts:403`) with no accompanying `type`/`interface` for the missed-call record, so the new
`twilioCallSid: callSid || undefined` literal already typechecks and **no edit was needed or made**
there. The only structurally similar shape is the client contract `MissedCall` in `src/types.ts:60-70`;
it was intentionally not modified, because (a) the brief scopes changes to `server.ts`, and (b) the
server never serialises `twilio_call_sid` to the client — the `/api/neon/data` mapper at
`server.ts:1189-1202` selects explicit columns — so `twilioCallSid` is a server-internal dedupe key and
adding it to the client type would be an inaccurate mirror.

### 3. (Deliberately not done) Dedupe read uses raw `pool.query`, not `runTenantQuery`

Per the brief and the task instructions, the dedupe `SELECT` is a raw `pool.query` at this stage. It is
**not** wrapped in `runTenantQuery`; Task 7 rewrites the `pool.query` calls in this same block. This
means the dedupe read currently executes outside the tenant transaction and is not RLS-scoped by
`app.current_organization_id` — it is a global `twilio_call_sid` lookup, which is the correct identity
for a dedupe key (CallSid is globally unique per Twilio account) but is worth Sentinel's attention
when Task 7 lands.

## Notes for Sentinel / Probe

- **Sentinel:** the dedupe read is unguarded by tenant context until Task 7 (Deviation 3). Also note
  the guard is read-then-insert with no `ON CONFLICT` fallback — two simultaneous deliveries of the
  same CallSid can both pass the `SELECT` and race into the `INSERT`, where Task 5's unique partial
  index will reject the loser with a 23505 that lands in the outer `catch` (logged, then 2xx returned,
  so no customer-visible double-text). Acceptable for Twilio's serial retry pattern, but it is a TOCTOU
  window rather than a hard guarantee.
- **Probe:** POST the same `DialCallStatus=no-answer` + `DialCallSid=CAxxxx` twice to
  `/webhooks/twilio/voice-status` and confirm (a) both responses are 2xx XML, (b) exactly one
  "Duplicate voice-status callback" warn, (c) one `missed_calls` row, one `sms_messages` row, and one
  outbound SMS. Repeat with `DATABASE_URL` unset to exercise the `inMemoryCalls.some(...)` branch and
  its `twilioCallSid` field.
- **Task 7 must still run** and is expected to rewrite the `pool.query` calls at 2371, 2396, 2405,
  2413, 2421, 2425 inside this same block.
