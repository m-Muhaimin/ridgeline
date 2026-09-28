/**
 * The conversation service, exercised without a server, a database, a phone
 * number or an LLM.
 *
 * The fake client records every statement it is handed, so a test can assert
 * both what was written and — just as important — what was *not*: the savepoint
 * calls that a write path makes, and the absence of BEGIN / COMMIT / ROLLBACK,
 * which is what proves the service leaves the transaction to its caller.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processInboundSms, type ProcessInboundSmsInput } from '../conversation-service.js';
import { SlotUnavailableError } from '../booking-service.js';
import type { SmsAssistantResult } from '../ai-pipeline.js';

type Call = { text: string; params: any[] };

const ORG = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Apex Plumbing & Mechanical',
  trade: 'plumbing',
  technicianName: 'Mark Kowalski',
};
const FROM = '+15551234567';
const TO = '+15557824309';
const THREAD = '22222222-2222-2222-2222-222222222222';
/** Always inside working hours and always free, so the resolver is deterministic. */
const SLOT = '09:00 AM - 11:00 AM';

const stubResult: SmsAssistantResult = {
  source: 'fallback', replyText: 'Stub reply', intent: 'cancel', urgency: 'routine',
  actionTag: 'info_requested', serviceTitle: null, requestedSlot: null,
  extractedAddress: null, estimatedPrice: 250, shouldConfirmBooking: false,
};
const resultFrom = (over: Partial<SmsAssistantResult>): SmsAssistantResult => ({ ...stubResult, ...over });

/** Working hours/zone as `loadSchedulingPolicy` expects to read them back. */
const policyRow = {
  timezone: 'America/New_York', buffer_minutes: 45,
  working_hours_start: '07:30:00', working_hours_end: '17:30:00', work_weekends: false,
};

type Script = {
  /** A row per recognized statement; anything unscripted is an empty result. */
  rows?: (text: string) => any[];
  /** Thrown instead of returned, for the statements that must fail. */
  fail?: (text: string) => any;
};

type FakeDb = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }>; calls: Call[]; connect: () => Promise<never> };

/**
 * A stand-in for the client `runTenantQuery` hands its callback. It has no
 * server behind it and, deliberately, no working `connect` — the service must
 * never reach for a connection of its own.
 */
function fakeDb(script: Script = {}): FakeDb {
  const calls: Call[] = [];
  return {
    calls,
    async query(text: string, params: any[] = []) {
      calls.push({ text, params });
      const boom = script.fail?.(text);
      if (boom) throw boom;
      return { rows: script.rows?.(text) ?? [] };
    },
    async connect(): Promise<never> {
      throw new Error('processInboundSms must not connect: the caller owns the transaction');
    },
  };
}

const ran = (db: FakeDb, re: RegExp) => db.calls.some((c) => re.test(c.text));
const count = (db: FakeDb, re: RegExp) => db.calls.filter((c) => re.test(c.text)).length;
const lastParams = (db: FakeDb, re: RegExp) => db.calls.filter((c) => re.test(c.text)).at(-1)?.params;

/** The context trio, a known customer thread, and no bookings on file. */
const contextScript = (autoConfirmRoutine = true): Script => ({
  rows: (text) => {
    if (/SELECT \* FROM public\.assistant_settings/.test(text)) return [{ auto_confirm_routine: autoConfirmRoutine }];
    if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
    return [];
  },
});

function input(db: FakeDb, over: Partial<ProcessInboundSmsInput> = {}): ProcessInboundSmsInput {
  return {
    db, org: ORG, from: FROM, to: TO, body: 'Can you come Tuesday?',
    gemini: null, responder: async () => stubResult, ...over,
  };
}

/** Capture what the service logged, so an escalation can be asserted. */
async function capturingLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

// --- 1. Inquiry, no booking ------------------------------------------------

test('an inquiry is answered and stored, and nothing is booked', async () => {
  const db = fakeDb(contextScript());
  const { replyText } = await processInboundSms(input(db, {
    responder: async () => resultFrom({ intent: 'inquiry', replyText: 'Prices start at $195.' }),
  }));

  assert.equal(replyText, 'Prices start at $195.');
  assert.ok(ran(db, /INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, twilio_message_sid\)/), 'the customer message is stored');
  assert.ok(ran(db, /INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, parsed_intent\)/), 'the reply is stored');
  assert.deepEqual(lastParams(db, /INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, parsed_intent\)/)?.slice(0, 3),
    [THREAD, 'Prices start at $195.', 'info_requested']);
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET last_activity_at/)?.slice(0, 2), ['active', THREAD]);
  assert.equal(ran(db, /INSERT INTO public\.job_bookings/), false, 'an inquiry must not book');
  assert.equal(ran(db, /SAVEPOINT sched/), false, 'a read-only conversation takes no savepoint');

  // The transaction belongs to runTenantQuery, not to this function.
  assert.equal(ran(db, /^(BEGIN|COMMIT|ROLLBACK)$/), false, 'no transaction control may be issued here');
  assert.equal(ran(db, /connect\(\)/), false);
});

test('an existing thread is reused and its history reaches the assistant', async () => {
  let seen: any = null;
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD, address: '9 Elm St', customer_name: 'Marcus' }];
      if (/SELECT sender, text FROM public\.sms_messages/.test(text)) {
        return [{ sender: 'customer', text: 'hi' }, { sender: 'assistant', text: 'hello' }];
      }
      return [];
    },
  });

  const { replyText } = await processInboundSms(input(db, {
    responder: async (options) => { seen = options; return resultFrom({ intent: 'inquiry' }); },
  }));

  assert.equal(replyText, 'Stub reply');
  assert.equal(seen.conversationHistory.length, 2, 'both turns are offered as context');
  assert.equal(seen.customerPhone, FROM);
  assert.equal(seen.address, '9 Elm St', 'the thread address fills in for a customer with none on file');
  assert.equal(seen.customerName, 'Marcus');
  assert.equal(ran(db, /INSERT INTO public\.sms_threads/), false, 'the thread already exists');
});

test('an unknown customer gets a thread opened for the conversation', async () => {
  const db = fakeDb({
    rows: (text) => (text === 'SELECT * FROM public.assistant_settings WHERE organization_id = $1;' ? [{ auto_confirm_routine: true }] : []),
  });
  await processInboundSms(input(db, { responder: async () => resultFrom({ intent: 'inquiry' }) }));

  const insert = db.calls.find((c) => /INSERT INTO public\.sms_threads/.test(c.text));
  assert.ok(insert, 'a new conversation needs a thread row');
  const [threadId, orgId, , from] = insert!.params;
  assert.equal(orgId, ORG.id);
  assert.equal(from, FROM);
  assert.match(threadId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

// --- 2. Booking -----------------------------------------------------------

test('a stated, verified slot is booked and the thread points at it', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      if (/INSERT INTO public\.job_bookings/.test(text)) return [{ id: 'bk-1' }];
      return [];
    },
  });

  const { replyText } = await processInboundSms(input(db, {
    responder: async () => resultFrom({ intent: 'confirm', requestedSlot: SLOT, serviceTitle: 'Water Heater Replacement' }),
  }));

  assert.match(replyText, /^You're booked! 9:00 AM - 11:00 AM on \d{4}-\d{2}-\d{2}\./);
  const written = db.calls.find((c) => /INSERT INTO public\.job_bookings/.test(c.text))!;
  assert.equal(written.params[0], ORG.id, 'scoped to the organization that owns the thread');
  assert.equal(written.params[1], 'Customer');
  assert.equal(written.params[2], FROM);
  assert.equal(written.params[14], THREAD, 'the booking is linked to the thread it came from');
  assert.equal(written.params[15] instanceof Date, true, 'timestamps are written, not just the text slot');
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET booking_id/), ['bk-1', THREAD]);
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET last_activity_at/)?.slice(0, 2), ['active', THREAD]);
  assert.equal(ran(db, /^RELEASE SAVEPOINT sched$/), true, 'the savepoint is released once the write holds');
});

test('a slot that collides gets the taken-slot reply instead of an error', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      return [];
    },
    fail: (text) => (/INSERT INTO public\.job_bookings/.test(text)
      ? new SlotUnavailableError([{ id: 'bk-2', customerName: 'Dana', start: '2026-10-06T13:00:00Z', end: '2026-10-06T15:00:00Z' }])
      : null),
  });

  const { replyText } = await processInboundSms(input(db, {
    responder: async () => resultFrom({ intent: 'confirm', requestedSlot: SLOT }),
  }));

  assert.equal(replyText, 'Sorry - that time has just been taken. I will ask the technician to call you and find another slot.');
  assert.equal(ran(db, /^ROLLBACK TO SAVEPOINT sched$/), true, 'the rejected write is undone, not the conversation');
  assert.equal(ran(db, /INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, parsed_intent\)/), true,
    'the customer still gets an answer');
  assert.equal(ran(db, /UPDATE public\.sms_threads SET booking_id/), false, 'no booking means no booking_id');
});

test('the same recovery applies to the raw exclusion-constraint violation', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      return [];
    },
    fail: (text) => (/INSERT INTO public\.job_bookings/.test(text) ? { code: '23P01' } : null),
  });

  const { replyText } = await processInboundSms(input(db, {
    responder: async () => resultFrom({ intent: 'confirm', requestedSlot: SLOT }),
  }));

  assert.match(replyText, /that time has just been taken/);
});

// --- 3. Cancellation, gated on policy -------------------------------------

const cancelScript = (cancellable: boolean): Script => ({
  rows: (text) => {
    if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
    if (/SELECT 1 FROM public\.job_bookings/.test(text)) return [{ '?column?': 1 }];
    if (/SELECT o\.timezone/.test(text)) return [policyRow];
    if (/SET status = 'cancelled'/.test(text)) return cancellable ? [{ id: 'bk-1' }] : [];
    return [];
  },
});

test('a cancellable visit is cancelled and the thread stops being a booking', async () => {
  const db = fakeDb(cancelScript(true));
  const { replyText } = await processInboundSms(input(db, { responder: async () => stubResult }));

  assert.equal(replyText, 'Your booking is cancelled. Sorry to see you go - we will be here when you need us.');
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET last_activity_at/)?.slice(0, 2), ['active', THREAD]);
});

test('a visit already under way is not cancelled, and the thread stays booked', async () => {
  const db = fakeDb(cancelScript(false));
  const { replyText } = await processInboundSms(input(db, { responder: async () => stubResult }));

  assert.equal(replyText, 'That visit is already under way, so I was not able to cancel it. Reply here and the office will sort it out with you.');
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET last_activity_at/)?.slice(0, 2), ['booked', THREAD],
    'the active booking is still on file, so the thread must stay booked');
});

test('a cancellation is refused when the organization requires a human', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.assistant_settings/.test(text)) return [{ auto_confirm_routine: false }];
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT 1 FROM public\.job_bookings/.test(text)) return [{ '?column?': 1 }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      return [];
    },
  });
  const { replyText } = await processInboundSms(input(db, { responder: async () => stubResult }));

  assert.equal(ran(db, /SET status = 'cancelled'/), false, 'nothing may be cancelled without the switch on');
  assert.match(replyText, /^I can do /, 'the customer is offered real openings instead');
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET last_activity_at/)?.slice(0, 2), ['active', THREAD]);
});

test('a cancellation with nothing on the schedule changes no rows', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      return [];
    },
  });
  const { replyText } = await processInboundSms(input(db, { responder: async () => stubResult }));

  assert.equal(ran(db, /SET status = 'cancelled'/), false, 'there is nothing to cancel, so nothing is attempted');
  assert.match(replyText, /^I can do /);
});

// --- 4. Reschedule --------------------------------------------------------

test('a verified move reschedules the thread booking', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT 1 FROM public\.job_bookings/.test(text)) return [{ '?column?': 1 }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      if (/SELECT id FROM public\.job_bookings/.test(text)) return [{ id: 'bk-1' }];
      return [];
    },
  });

  const { replyText } = await processInboundSms(input(db, {
    responder: async () => resultFrom({ intent: 'reschedule', requestedSlot: SLOT }),
  }));

  assert.match(replyText, /^Moved\. You're booked for 9:00 AM - 11:00 AM on \d{4}-\d{2}-\d{2}\./);
  assert.equal(ran(db, /SET scheduled_date = \$1/), true, 'the booking moved');
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET last_activity_at/)?.slice(0, 2), ['rescheduled', THREAD]);
});

test('a move with no booking on file moves nothing', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      return [];
    },
  });

  const { replyText } = await processInboundSms(input(db, {
    responder: async () => resultFrom({ intent: 'reschedule', requestedSlot: SLOT }),
  }));

  assert.equal(ran(db, /SET scheduled_date = \$1/), false);
  assert.equal(replyText, 'Stub reply', 'with nothing to move the assistant answers, and offers nothing that was not verified');
  assert.deepEqual(lastParams(db, /UPDATE public\.sms_threads SET last_activity_at/)?.slice(0, 2), ['active', THREAD]);
});

// --- 5. Emergency ---------------------------------------------------------

test('an emergency with no verified opening is escalated, never booked', async () => {
  const db = fakeDb({
    rows: (text) => {
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      if (/SELECT o\.timezone/.test(text)) return [policyRow];
      return [];
    },
  });

  const { result, lines } = await capturingLog(() => processInboundSms(input(db, {
    responder: async () => resultFrom({
      intent: 'emergency', urgency: 'emergency', actionTag: 'emergency_escalated',
      serviceTitle: 'Emergency Burst Pipe & Valve Shutoff', replyText: 'Shut the valve and I will get Mark moving.',
    }),
  })));

  assert.equal(ran(db, /INSERT INTO public\.job_bookings/), false, 'safety advice must not become a booking');
  assert.equal(ran(db, /SAVEPOINT sched/), false);
  assert.ok(lines.some((l) => /\[policy\] propose_slot: emergency: no verified opening/.test(l)),
    `a human is put on notice, log was: ${JSON.stringify(lines)}`);
  assert.match(result.replyText, /^I can do /, 'the safety reply is replaced by real openings to hold the slot');
});

// --- 6. Persist failure policy --------------------------------------------

test('a recoverable booking failure is answered; any other failure is raised', async () => {
  const db = fakeDb({
    rows: (text) => (text === 'SELECT * FROM public.assistant_settings WHERE organization_id = $1;' ? [{ auto_confirm_routine: true }] : []),
    fail: (text) => (/INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, parsed_intent\)/.test(text)
      ? { code: 'XX000', message: 'connection to server lost' }
      : null),
  });

  await assert.rejects(
    () => processInboundSms(input(db, { responder: async () => resultFrom({ intent: 'inquiry' }) })),
    (err: any) => err.code === 'XX000',
  );
  assert.equal(count(db, /INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, parsed_intent\)/), 1,
    'it fails on the write itself, not somewhere earlier');
  assert.equal(ran(db, /UPDATE public\.sms_threads/), false, 'the conversation is left to the rollback the caller owns');
});

// --- 7. Idempotency: one Twilio MessageSid is answered once -----------------

/** The pre-check and the race re-read are the same statement, so tests key on it. */
const DEDUPE_READ = /inbound\.twilio_message_sid = \$1/;
const CUSTOMER_INSERT = /INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, twilio_message_sid\)/;

test('a retried delivery replays the cached reply and writes nothing', async () => {
  const db = fakeDb({
    rows: (text) => (DEDUPE_READ.test(text) ? [{ text: 'Cached assistant reply' }] : []),
  });

  const result = await processInboundSms(input(db, {
    messageSid: 'SM123',
    responder: async () => resultFrom({ intent: 'inquiry' }),
  }));

  assert.deepEqual(result, { replyText: 'Cached assistant reply', duplicate: true });
  assert.deepEqual(db.calls[0].params, ['SM123'], 'the lookup is by the delivered id');
  assert.equal(db.calls.length, 1, 'the dedupe read is the first and the only statement issued');
  assert.equal(count(db, /INSERT|UPDATE/), 0, 'a retry re-runs nothing and stores nothing');
  assert.equal(ran(db, /SELECT \* FROM public\.assistant_settings/), false, 'the assistant is never consulted again');
});

test('a delivery that loses the unique-index race is answered from the cache', async () => {
  let dedupeReads = 0;
  const db = fakeDb({
    rows: (text) => {
      // The pre-check passes because the other delivery has not committed yet;
      // only the second read of the same statement sees the winner's reply.
      if (DEDUPE_READ.test(text)) return ++dedupeReads > 1 ? [{ text: 'Cached assistant reply' }] : [];
      if (/SELECT \* FROM public\.sms_threads/.test(text)) return [{ id: THREAD }];
      return [];
    },
    fail: (text) => (CUSTOMER_INSERT.test(text)
      ? { code: '23505', message: 'duplicate key value violates unique constraint "idx_sms_messages_twilio_message_sid"' }
      : null),
  });

  const result = await processInboundSms(input(db, {
    messageSid: 'SM123',
    responder: async () => resultFrom({ intent: 'inquiry' }),
  }));

  assert.deepEqual(result, { replyText: 'Cached assistant reply', duplicate: true });
  assert.equal(dedupeReads, 2, 'the lost race is resolved by one more look at the same statement');
  assert.equal(ran(db, /^SAVEPOINT msg$/), true, 'the message insert runs inside a savepoint');
  assert.equal(ran(db, /^ROLLBACK TO SAVEPOINT msg$/), true,
    'the losing delivery undoes only the insert, so the re-read still works');
  assert.equal(ran(db, /INSERT INTO public\.sms_messages \(thread_id, sender, text, action_tag, parsed_intent\)/), false,
    'the losing delivery must not write a second assistant message');
  assert.equal(ran(db, /UPDATE public\.sms_threads/), false, 'and it stops before the thread write');
});

test('the customer message records the MessageSid, or a null when it has none', async () => {
  const delivered = fakeDb(contextScript());
  const first = await processInboundSms(input(delivered, {
    messageSid: 'SM123',
    responder: async () => resultFrom({ intent: 'inquiry' }),
  }));
  assert.equal(first.duplicate, false, 'a first delivery is not a duplicate');
  assert.equal(ran(delivered, /^RELEASE SAVEPOINT msg$/), true, 'the savepoint is released once the insert holds');
  assert.deepEqual(lastParams(delivered, CUSTOMER_INSERT)?.slice(0, 3), [THREAD, 'Can you come Tuesday?', 'SM123'],
    'the id the unique index dedupes on is the id Twilio delivered');

  const apiOriginated = fakeDb(contextScript());
  await processInboundSms(input(apiOriginated, { responder: async () => resultFrom({ intent: 'inquiry' }) }));
  assert.deepEqual(lastParams(apiOriginated, CUSTOMER_INSERT)?.slice(0, 3), [THREAD, 'Can you come Tuesday?', null],
    'an API-originated message is stored without a sid');
  assert.equal(ran(apiOriginated, DEDUPE_READ), false, 'with no sid there is nothing to dedupe against');
});
