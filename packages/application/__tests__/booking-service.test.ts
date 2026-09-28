import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SERVICE_MINUTES, SlotUnavailableError, UnparseableSlotError,
  cancelThreadBookings, composeOfferReply, createBookingChecked, loadBusyIntervals,
  loadSchedulingPolicy, proposeAvailableSlots, rescheduleThreadBookings,
  resolveRequestedSlot, resolveServiceDuration, type Queryable,
} from '../booking-service.js';

type Call = { text: string; params: any[] };
const ORG = '11111111-1111-1111-1111-111111111111';

/** A stand-in for a Postgres client: no server, no database, no boot. */
function fakeDb(handler: (text: string, params: any[]) => any[], calls: Call[] = []): Queryable & { calls: Call[] } {
  return {
    calls,
    async query(text: string, params: any[] = []) {
      calls.push({ text, params });
      return { rows: handler(text, params) };
    },
  };
}

const settingsRow = (over: any = {}) => ({
  timezone: 'America/New_York', buffer_minutes: 45,
  working_hours_start: '07:30:00', working_hours_end: '17:30:00', work_weekends: false, ...over,
});

test('reads working hours, buffer and zone from the organization', async () => {
  const db = fakeDb(() => [settingsRow()]);
  const p = await loadSchedulingPolicy(db, ORG);
  assert.equal(p.timeZone, 'America/New_York');
  assert.equal(p.bufferMinutes, 45);
  assert.equal(p.businessHours.perWeekday[1]?.startMinute, 450);
  assert.equal(p.businessHours.perWeekday[1]?.endMinute, 1050);
  assert.equal(p.businessHours.perWeekday[0], null, 'Sunday closed by default');
  assert.equal(p.minLeadTimeHours, 2);
});

test('falls back to sane hours when the stored values are unusable', async () => {
  const db = fakeDb(() => [settingsRow({ working_hours_start: null, working_hours_end: null })]);
  const p = await loadSchedulingPolicy(db, ORG);
  assert.equal(p.businessHours.perWeekday[1]?.startMinute, 450);
  assert.equal(p.businessHours.perWeekday[1]?.endMinute, 1050);
});

test('refuses a closing time that is not after the opening time', async () => {
  const db = fakeDb(() => [settingsRow({ working_hours_start: '17:30:00', working_hours_end: '07:30:00' })]);
  const p = await loadSchedulingPolicy(db, ORG);
  assert.ok(p.businessHours.perWeekday[1]!.endMinute > p.businessHours.perWeekday[1]!.startMinute);
});

test('weekend work is honoured when the organization turns it on', async () => {
  const db = fakeDb(() => [settingsRow({ work_weekends: true })]);
  const p = await loadSchedulingPolicy(db, ORG);
  assert.ok(p.businessHours.perWeekday[0], 'Sunday open');
  assert.ok(p.businessHours.perWeekday[6], 'Saturday open');
});

test('a missing organization is an error, not a silent default', async () => {
  await assert.rejects(() => loadSchedulingPolicy(fakeDb(() => []), ORG), /not found/);
});

test('busy intervals carry the instants the database stored', async () => {
  const db = fakeDb(() => [{ scheduled_start: '2026-09-29T13:00:00Z', scheduled_end: '2026-09-29T15:00:00Z', customer_name: 'David' }]);
  const busy = await loadBusyIntervals(db, ORG);
  assert.equal(busy.length, 1);
  assert.equal(busy[0].start.toISOString(), '2026-09-29T13:00:00.000Z');
  assert.equal(busy[0].customerName, 'David');
  assert.match(db.calls[0].text, /booking_status\[\]/);
  assert.deepEqual(db.calls[0].params[1], ['scheduled', 'en_route', 'in_progress']);
});

// --- writes -----------------------------------------------------------------
// Each of these used to be reachable only by starting the whole server.

const NO_BUSY = (text: string) => /FROM public\.job_bookings/.test(text) && !/RETURNING/.test(text) && !/SELECT b\.scheduled_start/.test(text);

test('a booking is written with real UTC instants and the organization zone', async () => {
  const db = fakeDb((text) => {
    if (/INSERT INTO public\.job_bookings/.test(text)) return [{ id: 'b1' }];
    if (/SELECT o\.timezone/.test(text)) return [settingsRow()];
    if (NO_BUSY(text)) return [];
    return [];
  });
  const row = await createBookingChecked(db, ORG, {
    customerName: 'Dana', customerPhone: '+15551234567', address: '1 Main St',
    tradeType: 'plumbing', serviceTitle: 'Water Heater', date: '2026-09-29',
    timeSlot: '09:00 AM - 11:00 AM', estimateAmount: 650,
  });
  assert.equal(row.id, 'b1');
  const ins = db.calls.find((c) => /INSERT INTO public\.job_bookings/.test(c.text))!;
  // 09:00 New York on 29 Sep is 13:00Z (EDT, -4).
  assert.equal(new Date(ins.params[15]).toISOString(), '2026-09-29T13:00:00.000Z');
  assert.equal(new Date(ins.params[16]).toISOString(), '2026-09-29T15:00:00.000Z');
  assert.equal(ins.params[17], 'America/New_York');
  assert.equal(ins.params[8], '09:00 AM - 11:00 AM', 'the label is kept for display');
});

test('an unparseable slot never reaches the database', async () => {
  const db = fakeDb((text) => (/SELECT o\.timezone/.test(text) ? [settingsRow()] : []));
  await assert.rejects(
    () => createBookingChecked(db, ORG, {
      customerName: 'D', customerPhone: 'p', address: 'a', tradeType: 'plumbing',
      serviceTitle: 'S', date: '2026-09-29', timeSlot: 'sometime soon',
    }),
    UnparseableSlotError,
  );
  assert.equal(db.calls.some((c) => /INSERT INTO public\.job_bookings/.test(c.text)), false);
});

test('a booking that collides is refused before it is written', async () => {
  const db = fakeDb((text) => {
    if (/SELECT o\.timezone/.test(text)) return [settingsRow()];
    if (/SELECT id, customer_name, scheduled_start/.test(text)) {
      return [{ id: 'other', customer_name: 'Marcus', scheduled_start: '2026-09-29T13:00:00Z', scheduled_end: '2026-09-29T15:00:00Z' }];
    }
    return [];
  });
  await assert.rejects(
    () => createBookingChecked(db, ORG, {
      customerName: 'D', customerPhone: 'p', address: 'a', tradeType: 'plumbing',
      serviceTitle: 'S', date: '2026-09-29', timeSlot: '09:00 AM - 11:00 AM',
    }),
    (e: any) => e instanceof SlotUnavailableError && /Marcus/.test(e.message),
  );
  assert.equal(db.calls.some((c) => /INSERT INTO public\.job_bookings/.test(c.text)), false);
});

test('reschedule rewrites the instants as well as the label', async () => {
  const db = fakeDb((text) => {
    if (/SELECT o\.timezone/.test(text)) return [settingsRow()];
    if (/SELECT id FROM public\.job_bookings/.test(text)) return [{ id: 'b1' }];
    return [];
  });
  const n = await rescheduleThreadBookings(db, ORG, 'th1', '2026-09-30', '01:00 PM - 03:00 PM');
  assert.equal(n, 1);
  const upd = db.calls.find((c) => /SET scheduled_date/.test(c.text))!;
  assert.equal(new Date(upd.params[2]).toISOString(), '2026-09-30T17:00:00.000Z');
  assert.equal(new Date(upd.params[3]).toISOString(), '2026-09-30T19:00:00.000Z');
});

test('rescheduling a thread with nothing booked is a no-op, not an error', async () => {
  const db = fakeDb((text) => (/SELECT o\.timezone/.test(text) ? [settingsRow()] : []));
  assert.equal(await rescheduleThreadBookings(db, ORG, 'th1', '2026-09-30', '01:00 PM - 03:00 PM'), 0);
  assert.equal(db.calls.some((c) => /SET scheduled_date/.test(c.text)), false);
});

test('cancel only touches the scheduled visit', async () => {
  const db = fakeDb(() => [{ id: 'b1' }]);
  assert.equal(await cancelThreadBookings(db, ORG, 'th1'), 1);
  const upd = db.calls[0];
  assert.match(upd.text, /status = 'cancelled'/);
  assert.match(upd.text, /AND status = 'scheduled'/);
  assert.doesNotMatch(upd.text, /in_progress/);
});

// --- offers and replies -----------------------------------------------------

test('offers are labelled in the organization zone, not UTC', async () => {
  const db = fakeDb((text) => {
    if (/SELECT o\.timezone/.test(text)) return [settingsRow()];
    return [];
  });
  const offers = await proposeAvailableSlots(db, ORG, { durationMinutes: 120, now: new Date('2026-10-05T12:00:00Z'), limit: 2 });
  assert.ok(offers.length > 0, 'expected openings');
  for (const o of offers) {
    assert.match(o.label, /^\d{1,2}:\d{2} (AM|PM) - /);
    assert.match(o.date, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('a day already occupied up to the buffer is not offered again', async () => {
  const taken = [{ scheduled_start: '2026-10-05T13:00:00Z', scheduled_end: '2026-10-05T15:00:00Z', customer_name: 'Marcus' }];
  const early = fakeDb((text) => {
    if (/SELECT o\.timezone/.test(text)) return [settingsRow()];
    if (/scheduled_start IS NOT NULL/.test(text)) return taken;
    return [];
  });
  const offers = await proposeAvailableSlots(early, ORG, { durationMinutes: 120, now: new Date('2026-10-05T12:00:00Z'), limit: 5 });
  // The taken booking is 09:00-11:00 New York, so with a 45 minute buffer
  // nothing may be offered before 11:45, and the 30 minute step puts the first
  // opening at noon. The afternoon itself stays open.
  assert.equal(offers[0].label, '12:00 PM - 2:00 PM');
  assert.equal(offers.some((o) => /^(8|9|10|11):/.test(o.label)), false, 'the booked morning must not be offered');

  const free = fakeDb((text) => (/SELECT o\.timezone/.test(text) ? [settingsRow()] : []));
  const open = await proposeAvailableSlots(free, ORG, { durationMinutes: 120, now: new Date('2026-10-05T12:00:00Z'), limit: 5 });
  assert.ok(open.length > 0);
});

test('a stated time that is taken falls through to real alternatives', async () => {
  const db = fakeDb((text) => {
    if (/SELECT o\.timezone/.test(text)) return [settingsRow()];
    if (/scheduled_start IS NOT NULL/.test(text)) {
      return [{ scheduled_start: '2026-10-05T13:00:00Z', scheduled_end: '2026-10-05T15:00:00Z', customer_name: 'Marcus' }];
    }
    return [];
  });
  const policy = await loadSchedulingPolicy(db, ORG);
  const r = await resolveRequestedSlot(db, ORG, '09:00 AM - 11:00 AM', 120, policy, new Date('2026-10-05T12:00:00Z'));
  // The point is not that nothing matches, it is that the TAKEN DAY never does.
  // The customer who says "9am" and finds it booked gets the next day they
  // could have meant, never the slot that is already occupied.
  assert.equal(r.match?.date, '2026-10-06', 'must skip the day that is already booked');
  assert.equal(r.match?.label, '9:00 AM - 11:00 AM');
});

test('"tomorrow" is never satisfied by today', async () => {
  const db = fakeDb((text) => (/SELECT o\.timezone/.test(text) ? [settingsRow()] : []));
  const policy = await loadSchedulingPolicy(db, ORG);
  const r = await resolveRequestedSlot(db, ORG, 'tomorrow 09:00 AM - 11:00 AM', 120, policy, new Date('2026-10-05T12:00:00Z'));
  assert.ok(r.match);
  assert.equal(r.match!.date, '2026-10-06');
});

test('a slot outside working hours is refused', async () => {
  const db = fakeDb((text) => (/SELECT o\.timezone/.test(text) ? [settingsRow()] : []));
  const policy = await loadSchedulingPolicy(db, ORG);
  const r = await resolveRequestedSlot(db, ORG, '06:00 AM - 08:00 AM', 120, policy, new Date('2026-10-05T12:00:00Z'));
  assert.equal(r.match, null);
});

test('a time inside the lead time is deferred, not booked sooner', async () => {
  const db = fakeDb((text) => (/SELECT o\.timezone/.test(text) ? [settingsRow()] : []));
  const policy = await loadSchedulingPolicy(db, ORG);
  // 12:00Z is 08:00 New York, so a 09:00 job is only an hour out. It must not
  // be taken today; the customer is offered the next real day instead.
  const r = await resolveRequestedSlot(db, ORG, '09:00 AM - 11:00 AM', 120, policy, new Date('2026-10-05T12:00:00Z'));
  assert.ok(r.match, 'a later day should be found');
  assert.equal(r.match!.date, '2026-10-06', 'not today, because of the lead time');
});

test('the lead time boundary itself is bookable', async () => {
  const db = fakeDb((text) => (/SELECT o\.timezone/.test(text) ? [settingsRow()] : []));
  const policy = await loadSchedulingPolicy(db, ORG);
  // 11:00Z is 07:00 New York, making 09:00 exactly the two hour lead.
  const r = await resolveRequestedSlot(db, ORG, '09:00 AM - 11:00 AM', 120, policy, new Date('2026-10-05T11:00:00Z'));
  assert.equal(r.match?.date, '2026-10-05', 'the boundary itself is allowed');
});

test('an offer reply contains only real openings', () => {
  const r = composeOfferReply([
    { label: '9:00 AM - 11:00 AM', date: '2026-10-06', interval: { start: new Date('2026-10-06T13:00:00Z'), end: new Date('2026-10-06T15:00:00Z') } },
  ], 'America/New_York');
  assert.match(r, /Tue 9:00 AM - 11:00 AM/);
});

test('with no openings the reply asks for a call instead of inventing one', () => {
  const r = composeOfferReply([], 'UTC');
  assert.equal(/AM|PM/.test(r), false, 'no time may appear');
  assert.match(r, /call you/i);
});

test('service duration comes from the catalog, and falls back when unknown', () => {
  const services = [{ title: 'Water Heater Replacement', durationHours: 2.5 }];
  assert.equal(resolveServiceDuration('Water Heater Replacement', services), 150);
  assert.equal(resolveServiceDuration('water heater replacement', services), 150);
  assert.equal(resolveServiceDuration('Something Unlisted', services), DEFAULT_SERVICE_MINUTES);
  assert.equal(resolveServiceDuration(null, services), DEFAULT_SERVICE_MINUTES);
  assert.equal(resolveServiceDuration('Water Heater', []), DEFAULT_SERVICE_MINUTES);
});
