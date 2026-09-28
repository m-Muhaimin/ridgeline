# Task 6 — CallSid idempotency (Sprint 3, item 3.3, CallSid half)

## Goal
The voice-status webhook (`/webhooks/twilio/voice-status`) also retries until 2xx. A retried
`no-answer`/`busy`/`failed` callback currently re-sends the auto-SMS and re-inserts the missed call
record (plus thread + message rows). This task: (a) write `twilio_call_sid` (column already exists at
`supabase/migrations/20260927000000_init_ridgeline_schema.sql:288`) on the missed-call record and the
in-memory call record, (b) short-circuit repeated deliveries before the SMS is sent. The unique
index `idx_missed_calls_twilio_call_sid` already ships in Task 5's migration + `initDb()` — no schema
work here.

## Files
- **Edit** `server.ts` — the `/webhooks/twilio/voice-status` handler body only.

## Design decisions (already made)
- Dedupe happens BEFORE the `twilioClient.messages.create` send — a retried callback must not
  re-text the customer.
- CallSid source: `req.body.DialCallSid || req.body.CallSid || ''`, exactly the identity Twilio puts
  on a `DialCallStatus` callback (the same `callSid` on retries).
- The in-memory missed-call records gain an optional `twilioCallSid` field; add it to the in-memory
  type declaration (locate via `inMemoryCalls` definition) so the object literal below typechecks.

## Exact final handler body (replace the current `/webhooks/twilio/voice-status` handler, ~2930-3010)
Keep the `dialStatus`, `from`, `to`, `duration` consts, the `if (dialStatus !== 'completed')` gate,
the `findOrgByTwilioNumber` resolution and the Task 2 unknown-org hard-stop EXACTLY as they are.
Then replace the inside of the `try` block with:

```ts
      const orgId = org.id;
      const callSid = req.body.DialCallSid || req.body.CallSid || '';
      const techName = org.technician_name || org.technicianName || 'Mark';
      const bizName = org.name;

      const autoSms = `Hey! This is the dispatcher for ${techName} at ${bizName}. ${techName} is currently on a job and can't pick up. What issue are you experiencing today? Reply here and I'll get you on the schedule!`;

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

      // Trigger instant outbound SMS via Twilio API if credentials are configured
      if (twilioClient) {
        await twilioClient.messages.create({
          from: to,
          to: from,
          body: autoSms,
        }).catch((err: any) => console.warn('Twilio instant textback failed:', err.message));
      }

      // Persist missed call to database or in-memory
      if (pool) {
        await pool.query(
          `INSERT INTO public.missed_calls (
            organization_id, caller_name, caller_phone, ring_duration_seconds,
            auto_sms_sent, auto_sms_sent_at, converted_to_booking, twilio_call_sid
          ) VALUES ($1, $2, $3, $4, true, NOW(), false, $5);`,
          [orgId, 'Caller', from, duration || 15, callSid || null]
        );

        // Ensure an SMS thread exists for this customer so the follow-up text is visible in SMS inbox
        const thCheck = await pool.query(
          'SELECT id FROM public.sms_threads WHERE organization_id = $1 AND customer_phone = $2 LIMIT 1;',
          [orgId, from]
        );

        let threadId: string;
        if (thCheck.rows.length === 0) {
          threadId = crypto.randomUUID ? crypto.randomUUID() : toUuid(`mc-th-${from}-${Date.now()}`);
          await pool.query(
            `INSERT INTO public.sms_threads (
              id, organization_id, customer_name, customer_phone, trade_type, status, last_activity_at
            ) VALUES ($1, $2, 'Caller', $3, $4, 'active', NOW());`,
            [threadId, orgId, from, org.trade || 'plumbing']
          );
        } else {
          threadId = thCheck.rows[0].id;
          await pool.query('UPDATE public.sms_threads SET last_activity_at = NOW() WHERE id = $1;', [threadId]);
        }

        // Record the outbound auto-SMS in the thread
        await pool.query(
          `INSERT INTO public.sms_messages (thread_id, sender, text, action_tag)
           VALUES ($1, 'assistant', $2, 'slot_offered');`,
          [threadId, autoSms]
        );
      } else {
        inMemoryCalls.unshift({
          id: `mc-${Date.now()}`,
          organizationId: orgId,
          callerName: 'Caller',
          callerPhone: from,
          ringDurationSeconds: duration || 15,
          autoSmsSent: true,
          convertedToBooking: false,
          twilioCallSid: callSid || undefined,
          urgency: 'routine',
          createdAt: new Date().toISOString(),
        });
      }
```

Nothing outside this `try` block changes; the outer `catch` and the final empty-XML response stay as
they are today. Note the `bizName` fallback 'Apex Plumbing & Mechanical' is replaced by
`org.name` — org is now definite (Task 2), and the empty-string edge is impossible because the
handler already returned for unknown orgs.

## Verification
```bash
npx tsc --noEmit
npm test
```
Manual: `grep -n "twilio_call_sid" server.ts` → dedupe query + INSERT column/$5 + in-memory field.

## Where it fits
Closes the CallSid half of Sprint 3 item 3.3 on top of Task 5's index. Task 7 (voice-status tenant
wrap) rewrites the `pool.query` calls in this same block — run Task 7 after this one.