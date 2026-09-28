# Task 4 — Extract the SMS conversation service (Sprint 2, item 2.3 part 2 + Sprint 3, item 3.2 SMS half)

## Goal
Move the entire database path of the `/webhooks/twilio/sms` handler (context load, customer/thread
lookup, assistant call, persist-and-book transaction) into
`packages/application/conversation-service.ts` as `processInboundSms`, which the webhook invokes
inside ONE `runTenantQuery` transaction (Task 1's helper). The in-memory (no-pool) webhook path
stays in `server.ts`, refactored onto shared helpers. Behavior identical except: webhook DB work is
now atomic in a single tenant transaction, and non-recoverable persist errors propagate to the
webhook's error TwiML instead of being swallowed.

## Files
- **Create** `packages/application/id-utils.ts` — `toUuid` moved verbatim from `server.ts` (~line 283, the md5-to-uuid helper)
- **Create** `packages/application/conversation-service.ts`
- **Create** `packages/application/__tests__/conversation-service.test.ts`
- **Edit** `server.ts`

## Design decisions (already made — do not revisit)
- `processInboundSms` performs NO `BEGIN`/`COMMIT`/`ROLLBACK`/`release`/`connect` — the caller's
  `runTenantQuery` owns the outer transaction. `SAVEPOINT sched` / `ROLLBACK TO SAVEPOINT sched` /
  `RELEASE SAVEPOINT sched` are kept inside the service (nested savepoints remain legal).
- **Responder seam:** the service takes an optional `responder` (defaults to `runSmsAssistant`).
  Rationale: the rule-based fallback never emits `intent: 'cancel'` (verified: the fallback only
  produces emergency/reschedule/confirm/inquiry), so the cancel WIP branch is only reachable via a
  crafted result — the tests inject a stub. This is the only new production API surface.
- **Persist error policy (behavior change, intentional):** within the moved block, a recoverable
  booking error (`SlotUnavailableError`, `UnparseableSlotError`, `code === '23P01'`) keeps the old
  `SLOT_UNAVAILABLE_REPLY` path; ANY other error thrown after the savepoint is now rethrown (the
  outer `runTenantQuery` rolls back; the webhook's outer `catch` sends the generic error TwiML).
  Previously such errors were caught, logged, rolled back and swallowed while still replying.
- `getOrgContext` (~2252-2305) is deleted. Its DB branch becomes exported `loadOrgContext(db, orgId)`
  in the service; its in-memory branch becomes `getInMemoryOrgContext(orgId)` in `server.ts`.
- `toUuid` becomes an import (`'./packages/application/id-utils.js'`) in both `server.ts` and the
  service — it is used by the thread-id generation in both.
- MongoDB-style nothing: no new npm deps.

## Exact code — `packages/application/id-utils.ts`
Move the current `toUuid` body from `server.ts` verbatim. Export it as `export function toUuid(input: string): string`.

## Exact code — `packages/application/conversation-service.ts`
```ts
import { GoogleGenAI } from '@google/genai';
import {
  SlotUnavailableError, UnparseableSlotError, cancelThreadBookings, composeOfferReply,
  createBookingChecked, loadSchedulingPolicy, rescheduleThreadBookings, resolveRequestedSlot,
  resolveServiceDuration,
  type ResolvedSlot, type SchedulingPolicy, type SlotOffer,
} from './booking-service.js';
import { decide, isWriteAction } from '../domain/conversations/policy-engine.js';
import { runSmsAssistant, DEFAULT_OPENAI_API_KEY, DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL,
  type RunSmsAssistantOptions, type SmsAssistantResult } from './ai-pipeline.js';
import { toUuid } from './id-utils.js';
import type { Queryable } from './tenant-context.js';

export type OrgForConversation = {
  id: string;
  name: string;
  trade?: string | null;
  technician_name?: string | null;
  technicianName?: string | null;
};

export type LoadedOrgContext = {
  settings: any;
  services: any[];
  bookings: any[];
};

export type SmsResponder = (
  options: RunSmsAssistantOptions,
  deps: { gemini: GoogleGenAI | null },
) => Promise<SmsAssistantResult>;

export type ProcessInboundSmsInput = {
  db: Queryable;
  org: OrgForConversation;
  from: string;
  to: string;
  body: string;
  gemini: GoogleGenAI | null;
  responder?: SmsResponder;
};

export type ProcessInboundSmsResult = { replyText: string };

export async function loadOrgContext(db: Queryable, orgId: string): Promise<LoadedOrgContext> {
  // Transcribe the DB branch of the current getOrgContext (server.ts ~2253-2298) verbatim, with
  // EXACTLY these substitutions:
  //   pool.query  ->  db.query
  //   DEFAULT_OPENAI_BASE_URL / DEFAULT_OPENAI_API_KEY / DEFAULT_OPENAI_MODEL resolve via the
  //   import above (delete nothing else about the settings mapping).
  // Keep the same return shape { settings, services, bookings }.
}

export async function processInboundSms(input: ProcessInboundSmsInput): Promise<ProcessInboundSmsResult> {
  const { db, org, from, body, gemini } = input;
  const responder = input.responder ?? ((o, d) => runSmsAssistant(o, d));
  const orgId = org.id;

  // --- 1. Org context (transcribed loadOrgContext call) ---
  const { settings, services, bookings } = await loadOrgContext(db, orgId);

  // --- 2 & 3. Customer + thread lookup/creation + history ---
  // Transcribe current server.ts lines 2609-2651 (customer lookup + thread lookup/insert + history)
  // with EXACTLY these substitutions: pool.query -> db.query; keep the in-memory threadId fallback
  // expression `crypto.randomUUID ? crypto.randomUUID() : toUuid(...)` as-is; keep `history`,
  // `customerName`, `customerAddress`, `threadId` assignment logic byte-for-byte.

  // --- 4. Assistant call, EXACTLY the current shape (server.ts 2684-2698), with substitutions: ---
  //   runSmsAssistant({...})  ->  responder({...}, { gemini })
  //   bookings/services/settings come from loadOrgContext instead of getOrgContext
  const assistantResult = await responder(
    {
      incomingText: body,
      customerName,
      customerPhone: from,
      address: customerAddress,
      conversationHistory: history,
      existingBookings: bookings,
      services,
      settings: {
        ...settings,
        businessName: org.name,
        tradespersonName: org.technician_name || org.technicianName || 'Mark',
        tradeType: org.trade || 'plumbing',
      },
    },
    { gemini },
  );

  // --- 5. Persist-and-book block ---
  // Transcribe current server.ts lines 2700-2854 (the ENTIRE `if (pool)` block INCLUDING the
  // staged cancel/reschedule WIP) with EXACTLY these substitutions, and nothing else:
  //   a) Delete: `const client = await pool.connect();`  `try {` ... and its matching `} finally {
  //      client.release(); }` — the function body must not connect, begin, commit, roll back, or
  //      release. The trailing `catch (persistErr: any) { ROLLBACK; log; }` is replaced by the
  //      recoverable-error rule below.
  //   b) `client.query(`  ->  `db.query(`   (every occurrence, including SAVEPOINT statements)
  //   c) Keep: SAVEPOINT sched / ROLLBACK TO SAVEPOINT sched / RELEASE SAVEPOINT sched, the
  //      decision wiring (decide/isWriteAction/cancelThreadBookings/rescheduleThreadBookings/
  //      createBookingChecked), SLOT_UNAVAILABLE_REPLY, and all reply strings byte-for-byte.
  //   d) The inner booking catch becomes:
  //        const recoverable = bookingErr instanceof SlotUnavailableError ||
  //          bookingErr instanceof UnparseableSlotError || bookingErr?.code === '23P01';
  //        if (!recoverable) throw bookingErr;
  //      (the ROLLBACK TO SAVEPOINT + slot-unavailable reply handling stays for the recoverable case)
  //   e) The message/thread INSERT/UPDATE statements at the end of the block run on db, then the
  //      block simply ends (no COMMIT).

  return { replyText };
}
```
Note: `threadStatus`, `bookingId`, `policy`, `offers`, `resolved` are locals of step 5 exactly as
today; `to`/`body` are used as today. Compile-cleanliness trap: the WIP block's `SLOT_UNAVAILABLE_REPLY`
const and `replyText = assistantResult.replyText` must come before step 5 in the service, exactly as
the current file has them at 2703-2710.

## `server.ts` edits
1. Imports: add
   `import { processInboundSms, loadOrgContext, type OrgForConversation } from './packages/application/conversation-service.js';`
   `import { toUuid } from './packages/application/id-utils.js';`
   and delete the local `toUuid` (~283). Adjust the existing `runSmsAssistant` import to also bring
   `runSmsAssistant` and `type RunSmsAssistantOptions` (it will now be used only by the in-memory path).
2. Delete `getOrgContext` (~2252-2305) and add in its place:
   ```ts
   function getInMemoryOrgContext(orgId: string) {
     const settings = inMemorySettings[orgId] || inMemorySettings[inMemoryOrgs[0]?.id] || {};
     const services = inMemoryServices.filter(s => s.organizationId === orgId);
     const bookings = inMemoryBookings.filter(b => b.organizationId === orgId);
     return { settings, services, bookings };
   }
   ```
   (If `inMemoryOrgs[0]?.id` optional chaining alters behavior vs the old `inMemoryOrgs[0].id`,
   keep the old non-optional form — Task 2 already guarantees an org exists here.)
3. Rewrite `/webhooks/twilio/sms` (2591-2911) to:
   ```ts
   app.post('/webhooks/twilio/sms', twilioFormParser, verifyTwilioSignature, async (req: Request, res: Response) => {
     const from = req.body.From;
     const to = req.body.To;
     const body = req.body.Body || '';

     try {
       const org = await findOrgByTwilioNumber(to);
       if (!org) {
         console.warn('No organization found for Twilio number:', to);
         const twiml = new MessagingResponse();
         twiml.message('RidgeLine Dispatch: Service currently offline for this number.');
         return res.type('text/xml').send(twiml.toString());
       }

       const orgId = org.id;

       if (pool) {
         // One tenant-scoped transaction for the whole conversation: context, lookup, AI, persist.
         const outcome = await runTenantQuery(pool, orgId, null, (client) =>
           processInboundSms({ db: client, org, from, to, body, gemini: ai }));
         const twiml = new MessagingResponse();
         twiml.message(outcome.replyText);
         return res.type('text/xml').send(twiml.toString());
       }

       // In-memory fallback (no DATABASE_URL): behavior identical to today, using the helpers.
       const { settings, services, bookings } = getInMemoryOrgContext(orgId);
       // ...transcribe the current in-memory branch verbatim: customer/thread/history (2652-2681),
       // runSmsAssistant({ ...settings merge... }, { gemini: ai }) (2684-2698 shape), and the
       // in-memory persistence + in-memory booking record (2855-2899). Reply with
       // assistantResult.replyText exactly as the current code does (2901-2904).
     } catch (err: any) {
       console.error('Twilio SMS webhook error:', err);
       const twiml = new MessagingResponse();
       twiml.message("Sorry, something went wrong on our end — we'll follow up shortly.");
       res.type('text/xml').send(twiml.toString());
     }
   });
   ```
   The in-memory branch keeps every string, `localDateInZone`, `stripDayQualifier`, and the `if
   (assistantResult.requestedSlot)` in-memory booking push exactly as they are today.

## Tests — `packages/application/__tests__/conversation-service.test.ts`
Follow the `fakeDb` pattern from `packages/application/__tests__/booking-service.test.ts` (scripted
responses keyed on SQL substring; default `{ rows: [] }`; `rowCount` support where the booking
service relies on it). All tests use a **stub responder** (never `runSmsAssistant`), so nothing
touches the network.

`const stubResult: SmsAssistantResult = { source: 'fallback', replyText: 'Stub reply', intent: 'cancel', urgency: 'routine', actionTag: 'info_requested', serviceTitle: null, requestedSlot: null, extractedAddress: null, estimatedPrice: 250, shouldConfirmBooking: false };`

Script the fake db minimally: the 3 context SELECTs (assistant_settings → one row `{ auto_confirm_routine: true }`, services → `[]`, job_bookings → `[]`), customer SELECT → `[]`, thread SELECT → per-test, history SELECT → `[]`, active-booking SELECT → per-test, and cancel UPDATE → per-test `{ rows: [], rowCount: N }`.

1. **Inquiry, no booking (happy path):** responder intent `'inquiry'`, `requestedSlot: null` → resolves `{ replyText: 'Stub reply' }`; call log contains: customer message INSERT, assistant message INSERT, thread UPDATE with `'active'`; NO `job_bookings` INSERT; **no `BEGIN`, `COMMIT`, `ROLLBACK`, or `connect` call in the log** (proves the service is transaction-external).
2. **Existing thread reused:** thread SELECT returns one row + history SELECT returns 2 rows → assert the stub received `conversationHistory.length === 2` (capture the options arg), and no thread INSERT appears in the log.
3. **Cancel, cancellable (WIP path a):** responder intent `'cancel'`; active-booking SELECT returns 1 row; cancel UPDATE returns `rowCount: 1` → resolve with `replyText === 'Your booking is cancelled. Sorry to see you go - we will be here when you need us.'`; thread UPDATE arg is `'active'`.
4. **Cancel, nothing cancellable (WIP path b):** same as (3) but cancel UPDATE returns `rowCount: 0` → `replyText === 'That visit is already under way, so I was not able to cancel it. Reply here and the office will sort it out with you.'`; thread UPDATE arg is `'booked'`.
5. **Non-recoverable persist error rethrows:** fake db throws `{ code: 'XX000' }` on the assistant message INSERT → `await assert.rejects(processInboundSms(input))`.
(For 3/4, read `cancelThreadBookings` in `booking-service.ts` to confirm which SQL substring to script the `rowCount` against, and mirror its fixture style.)

## Verification
```bash
npx tsc --noEmit
npm test
```

## Where it fits
Closes Sprint 2 item 2.3 and the SMS half of 3.2. Task 5 extends `processInboundSms` with MessageSid
idempotency; Task 1's `runTenantQuery` signature is consumed here first.