/**
 * The inbound-SMS conversation, as one transaction.
 *
 * This block used to live inside the `/webhooks/twilio/sms` handler in
 * `server.ts`: load the organization's context, find or open the customer's
 * thread, ask the assistant, then write the exchange and any schedule change
 * in a single transaction. That made the only interesting logic in the product
 * unreachable without a live database, a live phone number and a real LLM.
 *
 * It is here now, behind a `Queryable` port. Two rules make it safe to extract:
 *
 *   1. The caller owns the transaction. `processInboundSms` never connects,
 *      BEGINs, COMMITs, ROLLBACKs or releases. The webhook runs it inside a
 *      single `runTenantQuery(pool, orgId, …)`, so the context load, the thread
 *      write, the booking and the assistant message all commit or fail
 *      together — the reply can no longer describe a booking that rolled back.
 *      Nested savepoints (`SAVEPOINT msg` for the inbound message, `SAVEPOINT sched`
 *      for the schedule write) stay: they are the one place a constraint violation
 *      is absorbed without aborting the outer transaction.
 *
 *   2. The assistant is a seam, not a dependency. `responder` defaults to the
 *      real `runSmsAssistant`; tests pass a stub and never touch the network.
 *
 * Persist failures are split by whether the customer can do anything about
 * them: a rejected slot gets a reply, anything else propagates so the webhook
 * answers with its error TwiML instead of pretending the exchange was stored.
 */
import crypto from 'crypto';
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

/** The organization fields the conversation actually reads. */
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
  /** A client already inside the caller's tenant transaction. */
  db: Queryable;
  org: OrgForConversation;
  from: string;
  to: string;
  body: string;
  gemini: GoogleGenAI | null;
  /**
   * Twilio's per-delivery id for this inbound message. Present on real webhook
   * deliveries and absent for API-originated calls, which is what makes the
   * dedupe below optional rather than mandatory.
   */
  messageSid?: string | null;
  /** Defaults to `runSmsAssistant`; tests inject a stub so no LLM is called. */
  responder?: SmsResponder;
};

/**
 * `duplicate` reports that this exact delivery was already answered and the
 * reply is the cached one. Nothing new was written and no assistant was run,
 * so the webhook can answer Twilio's retry without side effects.
 */
export type ProcessInboundSmsResult = { replyText: string; duplicate: boolean };

/**
 * The organization's assistant settings, service catalog and recent bookings.
 *
 * A failed read is logged and yields the same empty context the old code fell
 * back to when the query threw, so a hiccup here never costs the customer their
 * conversation.
 */
export async function loadOrgContext(db: Queryable, orgId: string): Promise<LoadedOrgContext> {
  try {
    const [settingsRes, servicesRes, bookingsRes] = await Promise.all([
      db.query('SELECT * FROM public.assistant_settings WHERE organization_id = $1;', [orgId]),
      db.query('SELECT * FROM public.services WHERE organization_id = $1 ORDER BY created_at ASC;', [orgId]),
      db.query('SELECT * FROM public.job_bookings WHERE organization_id = $1 ORDER BY scheduled_date DESC LIMIT 10;', [orgId]),
    ]);

    const s = settingsRes.rows[0];
    const settings = s ? {
      aiTone: s.ai_tone,
      autoConfirmRoutine: s.auto_confirm_routine,
      bufferMinutesBetweenJobs: s.buffer_minutes_between_jobs,
      workingHours: {
        start: s.working_hours_start?.slice(0, 5) || '07:30',
        end: s.working_hours_end?.slice(0, 5) || '17:30',
        workWeekends: s.work_weekends,
      },
      emergencyKeywords: s.emergency_keywords || [],
      llmProvider: s.llm_provider || 'openai_compatible',
      openaiBaseUrl: s.openai_base_url || DEFAULT_OPENAI_BASE_URL,
      openaiApiKey: s.openai_api_key || DEFAULT_OPENAI_API_KEY,
      openaiModel: s.openai_model || DEFAULT_OPENAI_MODEL,
    } : {};

    const services = servicesRes.rows.map(srv => ({
      id: srv.id,
      title: srv.title,
      trade: srv.trade,
      durationHours: parseFloat(srv.duration_hours) || 1.5,
      basePrice: parseFloat(srv.base_price) || 195,
      description: srv.description || '',
    }));

    const bookings = bookingsRes.rows.map(b => ({
      id: b.id,
      customerName: b.customer_name,
      date: typeof b.scheduled_date === 'string' ? b.scheduled_date.slice(0, 10) : new Date(b.scheduled_date).toISOString().slice(0, 10),
      timeSlot: b.time_slot,
      status: b.status,
    }));

    return { settings, services, bookings };
  } catch (e) {
    console.warn('Error fetching org context:', e);
  }

  return { settings: {}, services: [], bookings: [] };
}

export async function processInboundSms(input: ProcessInboundSmsInput): Promise<ProcessInboundSmsResult> {
  const { db, org, from, body, gemini } = input;
  const responder = input.responder ?? ((o, d) => runSmsAssistant(o, d));
  const orgId = org.id;

  // --- 0. Idempotency ------------------------------------------------------
  // Twilio retries a delivery until it sees a 2xx, and can replay one after a
  // timeout or a network blip. A repeat must never re-run the assistant,
  // re-insert the exchange, or double-book: the unique partial index on
  // `twilio_message_sid` makes the sid the identity of a delivery, and this
  // pre-check — the FIRST statement issued, before anything is read or
  // written — short-circuits a retry onto the reply that was already sent.
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

  // --- 1. Org context -----------------------------------------------------
  const { settings, services, bookings } = await loadOrgContext(db, orgId);

  // --- 2 & 3. Customer + thread lookup/creation + history -----------------
  // Look up or initialize customer
  let customerName = 'Customer';
  let customerAddress = '';
  let threadId: string;
  let history: Array<{ sender: string; text: string }> = [];

  // Lookup customer
  const custRes = await db.query(
    'SELECT * FROM public.customers WHERE organization_id = $1 AND phone = $2 LIMIT 1;',
    [orgId, from]
  );
  if (custRes.rows.length > 0) {
    customerName = custRes.rows[0].name;
    customerAddress = custRes.rows[0].address || '';
  }

  // Lookup or create SMS thread
  const thrdRes = await db.query(
    'SELECT * FROM public.sms_threads WHERE organization_id = $1 AND customer_phone = $2 LIMIT 1;',
    [orgId, from]
  );

  if (thrdRes.rows.length > 0) {
    const t = thrdRes.rows[0];
    threadId = t.id;
    if (!customerAddress && t.address) customerAddress = t.address;
    if (customerName === 'Customer' && t.customer_name) customerName = t.customer_name;

    // Fetch recent message history for context
    const msgRes = await db.query(
      'SELECT sender, text FROM public.sms_messages WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 12;',
      [threadId]
    );
    history = msgRes.rows;
  } else {
    threadId = crypto.randomUUID ? crypto.randomUUID() : toUuid(`tw-th-${from}-${Date.now()}`);
    await db.query(
      `INSERT INTO public.sms_threads (
        id, organization_id, customer_name, customer_phone, address, trade_type, status, last_activity_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW());`,
      [threadId, orgId, customerName, from, customerAddress, org.trade || 'plumbing']
    );
  }

  // --- 4. Assistant call --------------------------------------------------
  // Run AI / Assistant logic
  const assistantResult = await responder({
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
  }, { gemini });

  // --- 5. Persist-and-book ----------------------------------------------
  // Persist the exchange and any confirmed booking in ONE transaction. The
  // reply must never claim a booking that failed to commit, so the booking
  // decision happens before the assistant message is written.
  let replyText = assistantResult.replyText;
  // A thread is only "booked" once an interval is actually written, which is
  // decided inside the transaction below.
  let threadStatus = 'active';
  let bookingId: string | null = null;
  const SLOT_UNAVAILABLE_REPLY =
    'Sorry - that time has just been taken. I will ask the technician to call you and find another slot.';

  // The insert sits in its own savepoint so a lost unique-index race can be
  // rolled back locally: without it the aborting insert would poison the whole
  // transaction and the re-read below would throw 25P02 before it could find
  // the winning delivery's reply.
  await db.query('SAVEPOINT msg');
  try {
    await db.query(
      `INSERT INTO public.sms_messages (thread_id, sender, text, action_tag, twilio_message_sid)
       VALUES ($1, 'customer', $2, null, $3);`,
      [threadId, body, input.messageSid ?? null],
    );
    await db.query('RELEASE SAVEPOINT msg');
  } catch (insertErr: any) {
    // The pre-check above is a read, so two concurrent deliveries of the same
    // webhook can both pass it; the unique partial index is what actually
    // decides. Losing that race is not an error the customer should hear
    // about -- it is the same duplicate, caught a moment later.
    if (insertErr?.code === '23505' && input.messageSid) {
      await db.query('ROLLBACK TO SAVEPOINT msg');
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

  // Phase 1.5: intent becomes either a real interval or a list of real
  // openings -- never a time the language model made up. A booking is
  // only written once the customer has named an opening we verified.
  let policy: SchedulingPolicy | null = null;
  let resolved: ResolvedSlot | null = null;
  let offers: SlotOffer[] = [];

  const activeRes = await db.query(
    `SELECT 1 FROM public.job_bookings
      WHERE sms_thread_id = $1 AND status = ANY($2::booking_status[]) LIMIT 1;`,
    [threadId, ['scheduled', 'en_route', 'in_progress']],
  );
  const hasExistingBooking = (activeRes.rows?.length || 0) > 0;

  // Resolve what the customer actually said BEFORE deciding anything: the
  // policy engine takes a verified fact, not the model's opinion.
  if (assistantResult.intent !== 'inquiry' || assistantResult.requestedSlot) {
    policy = await loadSchedulingPolicy(db, orgId);
    const durationMinutes = resolveServiceDuration(assistantResult.serviceTitle, services);
    const resolution = await resolveRequestedSlot(
      db,
      orgId,
      assistantResult.requestedSlot,
      durationMinutes,
      policy,
    );
    resolved = resolution.match;
    offers = resolution.offers;
  }

  const decision = decide({
    intent: assistantResult.intent,
    urgency: assistantResult.urgency,
    serviceIdentified: !!(assistantResult.serviceTitle && assistantResult.serviceTitle !== 'General Service Diagnostic'),
    addressKnown: !!(assistantResult.extractedAddress || customerAddress),
    requestedSlot: assistantResult.requestedSlot,
    slotResolution: resolved ? 'available' : assistantResult.requestedSlot ? 'unavailable' : 'unstated',
    autoConfirmEnabled: settings.autoConfirmRoutine !== false,
    hasExistingBooking,
  });
  if (decision.requiresHuman) {
    console.log(`[policy] ${decision.action}: ${decision.reason} (thread ${threadId})`);
  }

  if (!decision.mayWrite && offers.length > 0) {
    // Nothing bookable yet: show the customer what is actually open.
    replyText = composeOfferReply(offers, policy!.timeZone);
    threadStatus = 'active';
  }

  if (decision.mayWrite && isWriteAction(decision.action) && (resolved || decision.action === 'cancel')) {
    // A savepoint lets a constraint violation be caught without
    // aborting the whole transaction.
    await db.query('SAVEPOINT sched');
    try {
      if (decision.action === 'cancel') {
        const cancelled = await cancelThreadBookings(db, orgId, threadId);
        if (cancelled > 0) {
          // The scheduled visit is gone, so the thread is no longer a
          // booked conversation.
          threadStatus = 'active';
          replyText = 'Your booking is cancelled. Sorry to see you go - we will be here when you need us.';
        } else {
          // Only a scheduled visit is cancellable. If the work has
          // already started there is nothing to cancel, and telling the
          // customer otherwise would be a lie they discover at the door.
          // The thread still has an active booking, so it stays 'booked'
          // and a human takes it from here.
          threadStatus = 'booked';
          replyText =
            'That visit is already under way, so I was not able to cancel it. Reply here and the office will sort it out with you.';
          console.warn('Cancel requested but no cancellable booking:', { threadId, orgId });
        }
      } else if (decision.action === 'reschedule') {
        const moved = await rescheduleThreadBookings(db, orgId, threadId, resolved!.date, resolved!.timeSlot);
        if (moved > 0) threadStatus = 'rescheduled';
        replyText = `Moved. You're booked for ${resolved!.label} on ${resolved!.date}. You'll get a text when the technician is on the way.`;
      } else {
        const booking = await createBookingChecked(db, orgId, {
          customerName,
          customerPhone: from,
          address: assistantResult.extractedAddress || customerAddress || 'Address requested via SMS',
          tradeType: org.trade || 'plumbing',
          serviceTitle: assistantResult.serviceTitle || 'General Diagnostic & Repair',
          date: resolved!.date,
          timeSlot: resolved!.timeSlot,
          status: 'scheduled',
          estimateAmount: assistantResult.estimatedPrice || 250,
          notes: 'Auto-confirmed by RidgeLine AI Assistant via live Twilio SMS webhook.',
          urgency: assistantResult.urgency || 'routine',
          createdFrom: 'sms',
          smsThreadId: threadId,
        });
        bookingId = booking.id;
        replyText = `You're booked! ${resolved!.label} on ${resolved!.date}. You'll get a text when the technician is on the way.`;
      }
      await db.query('RELEASE SAVEPOINT sched');
    } catch (bookingErr: any) {
      await db.query('ROLLBACK TO SAVEPOINT sched');
      // Recoverable means the customer can be told something useful and the
      // conversation continues. Everything else is a fault this process
      // cannot explain, and swallowing it would return a TwiML reply for an
      // exchange that was never stored -- so it propagates and the caller's
      // transaction rolls the whole conversation back.
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
  }

  await db.query(
    `INSERT INTO public.sms_messages (thread_id, sender, text, action_tag, parsed_intent)
     VALUES ($1, 'assistant', $2, $3, $4);`,
    [threadId, replyText, assistantResult.actionTag, JSON.stringify(assistantResult)],
  );

  await db.query(
    'UPDATE public.sms_threads SET last_activity_at = NOW(), status = $1 WHERE id = $2;',
    [threadStatus, threadId],
  );

  if (bookingId) {
    await db.query('UPDATE public.sms_threads SET booking_id = $1 WHERE id = $2;', [bookingId, threadId]);
  }

  return { replyText, duplicate: false };
}
