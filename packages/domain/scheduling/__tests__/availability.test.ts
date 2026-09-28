import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { zonedTimeToUtc, zonedParts, timeZoneOffsetMs, isValidTimeZone } from '../timezone.js';
import { availableSlots } from '../availability.js';
import { generateSlots, weekdayFor } from '../slot-generator.js';
import { stripDayQualifier } from '../slot-parser.js';

const hours = {
  perWeekday: {
    0: null, 1: { startMinute: 8 * 60, endMinute: 17 * 60 },
    2: { startMinute: 8 * 60, endMinute: 17 * 60 },
    3: { startMinute: 8 * 60, endMinute: 17 * 60 },
    4: { startMinute: 8 * 60, endMinute: 17 * 60 },
    5: { startMinute: 8 * 60, endMinute: 17 * 60 },
    6: { startMinute: 9 * 60, endMinute: 13 * 60 },
  },
};

describe('timezone conversion', () => {
  test('winter offset for New York is UTC-5', () => {
    assert.equal(timeZoneOffsetMs(new Date('2026-01-15T12:00:00Z'), 'America/New_York'), -5 * 3_600_000);
  });

  test('summer offset is UTC-4 (DST applied)', () => {
    assert.equal(timeZoneOffsetMs(new Date('2026-07-15T12:00:00Z'), 'America/New_York'), -4 * 3_600_000);
  });

  test('9am New York on a winter day is 14:00 UTC', () => {
    const utc = zonedTimeToUtc(2026, 1, 15, 9, 0, 'America/New_York');
    assert.equal(utc.toISOString(), '2026-01-15T14:00:00.000Z');
  });

  test('9am New York on a summer day is 13:00 UTC', () => {
    const utc = zonedTimeToUtc(2026, 7, 15, 9, 0, 'America/New_York');
    assert.equal(utc.toISOString(), '2026-07-15T13:00:00.000Z');
  });

  test('wall clock survives the round trip across DST', () => {
    const utc = zonedTimeToUtc(2026, 7, 15, 9, 0, 'America/New_York');
    const back = zonedParts(utc, 'America/New_York');
    assert.deepEqual([back.hour, back.minute], [9, 0]);
  });

  test('midnight survives the round trip', () => {
    const utc = zonedTimeToUtc(2026, 7, 15, 0, 0, 'America/New_York');
    const back = zonedParts(utc, 'America/New_York');
    assert.deepEqual([back.hour, back.minute], [0, 0]);
  });
});

describe('slot generation', () => {
  test('produces whole slots inside the window', () => {
    const slots = generateSlots({
      year: 2026, month: 1, day: 15, timeZone: 'America/New_York',
      businessHours: hours, durationMinutes: 120, stepMinutes: 120,
    });
    assert.equal(slots.length, 4); // 8-10, 10-12, 12-14, 14-16; 16-18 would overrun 17:00
  });

  test('returns nothing on a closed day', () => {
    assert.equal(weekdayFor(2026, 1, 18), 0); // Sunday
    const slots = generateSlots({
      year: 2026, month: 1, day: 18, timeZone: 'America/New_York',
      businessHours: hours, durationMinutes: 60, stepMinutes: 60,
    });
    assert.equal(slots.length, 0);
  });

  test('Sunday honours its own shorter window', () => {
    const slots = generateSlots({
      year: 2026, month: 1, day: 18, timeZone: 'America/New_York',
      businessHours: { perWeekday: { ...hours.perWeekday, 0: { startMinute: 540, endMinute: 780 } } },
      durationMinutes: 120, stepMinutes: 120,
    });
    assert.equal(slots.length, 2); // 9-11, 11-13
  });
});

describe('availability', () => {
  // 12:00Z is 07:00 in New York, so the generated local day is Jan 15 itself.
  const morning = new Date('2026-01-15T12:00:00Z');
  const tenToTwelveNy = [{ start: new Date('2026-01-15T15:00:00Z'), end: new Date('2026-01-15T17:00:00Z') }];

  const base = {
    now: morning,
    timeZone: 'America/New_York',
    businessHours: hours,
    durationMinutes: 120,
    stepMinutes: 120,
    bufferMinutes: 0,
    minLeadTimeHours: 0,
    maxAdvanceDays: 0,
  };

  test('excludes a slot that collides with an existing booking', () => {
    const free = availableSlots({ ...base, busy: tenToTwelveNy });
    // 8-10, 10-12, 12-14, 14-16 local; the 10-12 booking is taken
    assert.deepEqual(free.map((s) => s.start.toISOString()), [
      '2026-01-15T13:00:00.000Z', '2026-01-15T17:00:00.000Z', '2026-01-15T19:00:00.000Z',
    ]);
  });

  test('a buffer removes slots that were free without one', () => {
    const free = availableSlots({ ...base, bufferMinutes: 120, busy: tenToTwelveNy });
    // 8-10 and 12-14 both reach into the booking once widened by two hours
    assert.deepEqual(free.map((s) => s.start.toISOString()), ['2026-01-15T19:00:00.000Z']);
  });

  test('a 15 minute buffer protects the gap before a booking', () => {
    const free = availableSlots({ ...base, bufferMinutes: 15, busy: tenToTwelveNy });
    // 8-10 now ends 10:15 local, which collides with the 10:00 booking
    assert.deepEqual(free.map((s) => s.start.toISOString()), ['2026-01-15T19:00:00.000Z']);
  });

  test('minimum lead time hides slots already due to start', () => {
    // 14:30Z is 09:30 local, so a two hour lead time excludes 8-10 and 10-12
    const free = availableSlots({
      ...base, now: new Date('2026-01-15T14:30:00Z'), minLeadTimeHours: 2, busy: [],
    });
    assert.deepEqual(free.map((s) => s.start.toISOString()), [
      '2026-01-15T17:00:00.000Z', '2026-01-15T19:00:00.000Z',
    ]);
  });

  test('a fully booked day yields nothing', () => {
    const free = availableSlots({
      ...base,
      busy: [{ start: new Date('2026-01-14T00:00:00Z'), end: new Date('2026-01-16T00:00:00Z') }],
    });
    assert.equal(free.length, 0);
  });

  test('a closed day yields nothing', () => {
    const free = availableSlots({
      ...base, now: new Date('2026-01-18T12:00:00Z'), busy: [], // Sunday is closed
    });
    assert.equal(free.length, 0);
  });

  test('walks into the next day when today is exhausted', () => {
    const free = availableSlots({
      ...base, maxAdvanceDays: 1,
      now: new Date('2026-01-15T23:00:00Z'), // 18:00 local, after close
      busy: [],
    });
    assert.deepEqual(free.map((s) => s.start.toISOString()), [
      '2026-01-16T13:00:00.000Z', '2026-01-16T15:00:00.000Z',
      '2026-01-16T17:00:00.000Z', '2026-01-16T19:00:00.000Z',
    ]);
  });
});

describe('time zone validation', () => {
  test('accepts canonical IANA zones', () => {
    assert.equal(isValidTimeZone('America/New_York'), true);
    assert.equal(isValidTimeZone('Europe/London'), true);
    assert.equal(isValidTimeZone('UTC'), true);
  });

  test('rejects unknown, empty and non-string values', () => {
    assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
    assert.equal(isValidTimeZone('EST5EDT_Nonsense'), false);
    assert.equal(isValidTimeZone(''), false);
    assert.equal(isValidTimeZone('   '), false);
    assert.equal(isValidTimeZone(null), false);
    assert.equal(isValidTimeZone(undefined), false);
    assert.equal(isValidTimeZone(42), false);
  });

  test('offset lookup rejects an invalid zone instead of throwing', () => {
    assert.throws(() => timeZoneOffsetMs(new Date(), 'Nowhere/Fake'), RangeError);
  });
});

describe('stripDayQualifier', () => {
  test('removes the day word and keeps the time range byte-for-byte', () => {
    assert.equal(stripDayQualifier('Tomorrow 09:00 AM - 11:00 AM'), '09:00 AM - 11:00 AM');
    assert.equal(stripDayQualifier('today 8:30 AM - 10:30 AM'), '8:30 AM - 10:30 AM');
    assert.equal(stripDayQualifier('tmr 1:00 PM - 3:00 PM'), '1:00 PM - 3:00 PM');
    assert.equal(stripDayQualifier('Tomorrow, 09:00 AM - 11:00 AM'), '09:00 AM - 11:00 AM');
  });

  test('leaves a leading zero intact (regression: was rewritten as 8:30 AM)', () => {
    assert.equal(stripDayQualifier('Tomorrow 08:30 AM - 10:30 AM'), '08:30 AM - 10:30 AM');
  });

  test('is a no-op when there is no qualifier', () => {
    assert.equal(stripDayQualifier('09:00 AM - 11:00 AM'), '09:00 AM - 11:00 AM');
    assert.equal(stripDayQualifier('  09:00 AM - 11:00 AM  '), '09:00 AM - 11:00 AM');
  });

  test('does not eat a time that merely starts with a day-like token', () => {
    // "Sat" here is part of the text, not a prefix qualifier.
    assert.equal(stripDayQualifier('Sat 09:00 AM - 11:00 AM'), '09:00 AM - 11:00 AM');
  });

  test('returns the original when stripping would empty the string', () => {
    assert.equal(stripDayQualifier('Tomorrow'), 'Tomorrow');
  });

  test('handles non-strings', () => {
    assert.equal(stripDayQualifier(null), null);
    assert.equal(stripDayQualifier(undefined), null);
  });
});
