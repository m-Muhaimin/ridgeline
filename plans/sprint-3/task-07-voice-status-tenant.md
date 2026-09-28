# Task 7 — Make the voice-status webhook tenant-aware (Sprint 3, item 3.2, voice-status half)

## Goal
The voice-status handler's database statements (Task 6's block) currently run as raw `pool.query`,
bypassing RLS. Wrap every one of them — the CallSid dedupe read AND the persist writes — in
`runTenantQuery(pool, orgId, null, ...)` so RLS applies, exactly like the SMS webhook after Task 4.

## Files
- **Edit** `server.ts` — the DB branch of `/webhooks/twilio/voice-status` only.

## Design decisions (already made)
- The outbound `twilioClient.messages.create` stays INSIDE the dedupe guard but OUTSIDE any
  transaction: a sent SMS cannot be rolled back, and nothing in the persist txn should gate it
  (the customer gets the textback; the DB record is best-effort under the same single ownership).
- The dedupe read joins the persist writes in one `runTenantQuery` invocation: both are tenant-scoped
  and the whole voice-status DB mutation is one unit.
- The early duplicate return happens AFTER the txn resolves (so the txn always completes) — this is
  a read-only txn for the duplicate case, and the outer `runTenantQuery` COMMIT is a no-op.

## Exact new DB section (replace the `if (pool) { ... } else { ... }` persist section from Task 6)
The handler code from Task 6 becomes (only the `if (pool)` block changes; everything else — org
resolution, callSid const, duplicate early-return when `pool` is null, `twilioClient` send, the
`inMemoryCalls` else-branch — stays byte-for-byte):

```ts
      // Persist missed call to database or in-memory
      if (pool) {
        await runTenantQuery(pool, orgId, null, async (client) => {
          // Idempotency re-check inside the tenant context: a second delivery of the same
          // CallSid must not duplicate the record. (Twilio may still race two callbacks.)
          if (callSid) {
            const dupRes = await client.query(
              'SELECT id FROM public.missed_calls WHERE twilio_call_sid = $1 LIMIT 1;',
              [callSid],
            );
            if (dupRes.rows.length > 0) {
              console.warn('Duplicate voice-status callback, skipping missed-call handling:', callSid);
              return; // nothing to write; the outer txn commits nothing
            }
          }

          await client.query(
            `INSERT INTO public.missed_calls (
              organization_id, caller_name, caller_phone, ring_duration_seconds,
              auto_sms_sent, auto_sms_sent_at, converted_to_booking, twilio_call_sid
            ) VALUES ($1, $2, $3, $4, true, NOW(), false, $5);`,
            [orgId, 'Caller', from, duration || 15, callSid || null]
          );

          // Ensure an SMS thread exists for this customer so the follow-up text is visible in SMS inbox
          const thCheck = await client.query(
            'SELECT id FROM public.sms_threads WHERE organization_id = $1 AND customer_phone = $2 LIMIT 1;',
            [orgId, from]
          );

          let threadId: string;
          if (thCheck.rows.length === 0) {
            threadId = crypto.randomUUID ? crypto.randomUUID() : toUuid(`mc-th-${from}-${Date.now()}`);
            await client.query(
              `INSERT INTO public.sms_threads (
                id, organization_id, customer_name, customer_phone, trade_type, status, last_activity_at
              ) VALUES ($1, $2, 'Caller', $3, $4, 'active', NOW());`,
              [threadId, orgId, from, org.trade || 'plumbing']
            );
          } else {
            threadId = thCheck.rows[0].id;
            await client.query('UPDATE public.sms_threads SET last_activity_at = NOW() WHERE id = $1;', [threadId]);
          }

          // Record the outbound auto-SMS in the thread
          await client.query(
            `INSERT INTO public.sms_messages (thread_id, sender, text, action_tag)
             VALUES ($1, 'assistant', $2, 'slot_offered');`,
            [threadId, autoSms]
          );
        });
      } else {
        // ... Task 6's in-memory unshift, unchanged ...
      }
```

Because Task 6 placed the dedupe BEFORE the `twilioClient` send, the pre-send duplicate guard
remains the primary protection; this in-transaction re-check closes the race where two callbacks
arrive before either INSERT commits. To keep the diff minimal, if you prefer to keep the Task 6
pre-send raw-pool dedupe AND add the txn wrap, you may delete the pre-send dedupe instead — the
in-txn re-check above is the single source of truth. Do not keep both (two code paths that must
agree is drift).

## Verification
```bash
npx tsc --noEmit
npm test
```
Manual: inside `/webhooks/twilio/voice-status`, no bare `pool.query` remains; all DB access is
`client.query` within `runTenantQuery`. `grep -n "pool.query" server.ts` → the remaining raw sites
are exactly: requireAuth's user lookup, the auth routes, `findOrgByTwilioNumber` (org resolution),
`/api/neon/execute-sql` (dev), and `/api/neon/status`.

## Where it fits
Closes the voice-status half of Sprint 3 item 3.2. Uses Task 1's `runTenantQuery` and assumes
Task 6's CallSid block exists (this task consumes it).