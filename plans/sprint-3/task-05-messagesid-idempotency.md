# Task 5 — MessageSid idempotency (Sprint 3, item 3.3, MessageSid half)

## Goal
Twilio retries a webhook delivery until it gets a 2xx, and can replay after a timeout or network
blip. Without idempotency each retry re-runs the LLM, re-inserts messages, and can double-book.
This task: (a) write `twilio_message_sid` (column already exists at
`supabase/migrations/20260927000000_init_ridgeline_schema.sql:267`) on the inbound customer message,
(b) short-circuit a repeated delivery to the previously-cached assistant reply, (c) enforce it with
a unique partial index in BOTH `initDb()` and a new migration (the CallSid index for Task 6 rides
along in the same migration so the repo rule "schema in both places" is satisfied once).

## Files
- **Edit** `packages/application/conversation-service.ts` — `processInboundSms` gains `messageSid` input, dedupe pre-check (the FIRST DB statement), sid column on the customer insert, 23505 race catch; result gains `duplicate`
- **Edit** `server.ts` — webhook passes `messageSid: req.body.MessageSid ?? null`
- **Edit** `server.ts` `initDb()` — add both unique indexes (idempotent `CREATE UNIQUE INDEX IF NOT EXISTS`)
- **Create** `supabase/migrations/20260929000000_webhook_idempotency.sql`
- **Edit** `packages/application/__tests__/conversation-service.test.ts` — add dedupe tests

## Exact code — service changes (`packages/application/conversation-service.ts`)
1. Input type gains:
   ```ts
   messageSid?: string | null;
   ```
   Result type becomes `{ replyText: string; duplicate: boolean }`.
2. At the very top of `processInboundSms`, before `loadOrgContext`:
   ```ts
   if (input.messageSid) {
     const dup = await db.query(
       `SELECT m.text FROM public.sms_messages m
        JOIN public.sms_messages inbound ON inbound.thread_id = m.thread_id
        WHERE inbound.twilio_message_sid = $1 AND m.sender = 'assistant'
        ORDER BY m.created_at DESC LIMIT 1;`,
       [input.messageSid],
     );
     if (dup.rows.length > 0) {
       console.log('Duplicate Twilio MessageSid, replaying cached reply:', input.messageSid);
       return { replyText: dup.rows[0].text, duplicate: true };
     }
   }
   ```
3. The customer message INSERT (transcribed in Task 4, currently
   `INSERT INTO public.sms_messages (thread_id, sender, text, action_tag) VALUES ($1, 'customer', $2, null);`)
   becomes:
   ```ts
   await db.query(
     `INSERT INTO public.sms_messages (thread_id, sender, text, action_tag, twilio_message_sid)
      VALUES ($1, 'customer', $2, null, $3);`,
     [threadId, body, input.messageSid ?? null],
   );
   ```
   wrapped in the race-catch:
   ```ts
   try {
     await db.query(... the insert above ...);
   } catch (insertErr: any) {
     if (insertErr?.code === '23505' && input.messageSid) {
       const dup = await db.query(
         `SELECT m.text FROM public.sms_messages m
          JOIN public.sms_messages inbound ON inbound.thread_id = m.thread_id
          WHERE inbound.twilio_message_sid = $1 AND m.sender = 'assistant'
          ORDER BY m.created_at DESC LIMIT 1;`,
         [input.messageSid],
       );
       if (dup.rows.length > 0) {
         return { replyText: dup.rows[0].text, duplicate: true };
       }
     }
     throw insertErr;
   }
   ```
   Everything downstream of the catch (thread update etc.) is skipped by the early return, so the
   outer `runTenantQuery` commit writes nothing new — accepting the documented edge that a
   concurrent duplicate may leave a freshly-created thread row behind.
4. The final `return { replyText };` becomes `return { replyText, duplicate: false };`.

## Exact code — `supabase/migrations/20260929000000_webhook_idempotency.sql`
```sql
-- Webhook idempotency
-- Twilio webhooks retry until they receive a 2xx, so a retried delivery must
-- never re-run the LLM, re-insert messages, or double-book. MessageSid rows
-- are kept distinct from CallSid rows; a NULL sid (API-originated messages)
-- must not collide with anything.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_messages_twilio_message_sid
  ON public.sms_messages (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_missed_calls_twilio_call_sid
  ON public.missed_calls (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;
```
(The `idx_missed_calls_twilio_call_sid` index serves Task 6; ship it here so a single migration
covers "webhook idempotency".)

## `server.ts` edits
1. In `initDb()`, find the existing indexes section (grep for `CREATE INDEX` / `CREATE UNIQUE INDEX`
   inside the `initDb` DDL) and append, with the same comment:
   ```sql
   -- Webhook idempotency: never process the same Twilio MessageSid / CallSid twice.
   CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_messages_twilio_message_sid
     ON public.sms_messages (twilio_message_sid) WHERE twilio_message_sid IS NOT NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS idx_missed_calls_twilio_call_sid
     ON public.missed_calls (twilio_call_sid) WHERE twilio_call_sid IS NOT NULL;
   ```
   (These must byte-match the migration file per the Global Constraint 5.)
2. In `/webhooks/twilio/sms`, the `processInboundSms` call gains the sid:
   ```ts
   processInboundSms({ db: client, org, from, to, body, messageSid: req.body.MessageSid ?? null, gemini: ai })
   ```

## Tests — new cases in `packages/application/__tests__/conversation-service.test.ts`
Reuse the Task 4 fake db + stub responder fixtures.
6. **Duplicate pre-check:** fake db returns a row `{ text: 'Cached assistant reply' }` for the
   dedupe JOIN query (key on `twilio_message_sid`) → call `processInboundSms({ ...rest, messageSid: 'SM123' })`
   → resolves `{ replyText: 'Cached assistant reply', duplicate: true }`; **no** assistant_settings /
   services / bookings SELECTs and **no** INSERT/UPDATE statements in the call log after the dedupe
   query (assert the log length is exactly 1).
7. **23505 race:** fake db throws `{ code: '23505' }` on the customer INSERT (key on
   `'customer'` + insert), then returns the cached row for the second dedupe query → resolves
   `{ replyText: 'Cached assistant reply', duplicate: true }`.
8. **Uniqueness regression:** the `INSERT ... twilio_message_sid` statement includes `$3` bound to
   `messageSid` when provided and `null` when omitted (assert the recorded params of that log entry).

## Verification
```bash
npx tsc --noEmit
npm test
```
Manual: `grep -n "twilio_message_sid" server.ts supabase/migrations/*.sql packages/application/conversation-service.ts`
→ migration + initDb + service (dedupe x2 + insert) all present.

## Where it fits
Closes the MessageSid half of Sprint 3 item 3.3. Depends on Task 4 (the service exists) and is the
prerequisite for Task 6's CallSid dedupe (which consumes `idx_missed_calls_twilio_call_sid`).