import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateSlots, weekdayFor, type BusinessHours } from '../slot-generator.js';
import { zonedParts } from '../timezone.js';

const TZ = 'America/New_York';

/** Open 07:00-17:30 every day so a DST transition day is exercised. */
const alwaysOpen: BusinessHours = {
  perWeekday: Object.fromEntries(
    Array.from({ length: 7 }, (_, d) => [d, { startMinute: 7 * 60, endMinute: 17 * 60 + 30 }]),
  ),
};

const weekdaysOnly: BusinessHours = {
  perWeekday: {
    ...alwaysOpen.perWeekday,
    0: null,
    6: null,
  },
};

const localTime = (instant: Date, zone = TZ) => {
  const p = zonedParts(instant, zone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

describe('generateSlots local time is DST-correct', () => {
  // Regression: slots used to be derived by adding minutes to local midnight.
  // When the UTC offset changes mid-day that lands on the wrong wall clock --
  // the whole day shifted by an hour on a transition day.
  test('spring-forward day starts at the configured local time', () => {
    const slots = generateSlots({
      year: 2026, month: 3, day: 8, timeZone: TZ,
      businessHours: alwaysOpen, durationMinutes: 60, stepMinutes: 60,
    });
    assert.equal(localTime(slots[0]!.start), '07:00');
    assert.equal(localTime(slots[slots.length - 1]!.start), '16:00');
  });

  test('fall-back day starts at the configured local time', () => {
    const slots = generateSlots({
      year: 2026, month: 11, day: 1, timeZone: TZ,
      businessHours: alwaysOpen, durationMinutes: 60, stepMinutes: 60,
    });
    assert.equal(localTime(slots[0]!.start), '07:00');
    assert.equal(localTime(slots[slots.length - 1]!.start), '16:00');
  });

  test('an ordinary day is unaffected', () => {
    const slots = generateSlots({
      year: 2026, month: 6, day: 10, timeZone: TZ,
      businessHours: alwaysOpen, durationMinutes: 60, stepMinutes: 60,
    });
    assert.equal(localTime(slots[0]!.start), '07:00');
  });

  test('job duration stays exact on a transition day', () => {
    const slots = generateSlots({
      year: 2026, month: 3, day: 8, timeZone: TZ,
      businessHours: alwaysOpen, durationMinutes: 120, stepMinutes: 120,
    });
    for (const slot of slots) {
      assert.equal((slot.end.getTime() - slot.start.getTime()) / 60_000, 120);
    }
  });

  test('a non-UTC zone resolves its own wall clock', () => {
    // Kathmandu is UTC+05:45, an offset no whole-hour math would produce.
    const slots = generateSlots({
      year: 2026, month: 6, day: 10, timeZone: 'Asia/Kathmandu',
      businessHours: alwaysOpen, durationMinutes: 60, stepMinutes: 60,
    });
    assert.equal(localTime(slots[0]!.start, 'Asia/Kathmandu'), '07:00');
    assert.equal(slots[0]!.start.toISOString(), '2026-06-10T01:15:00.000Z');
  });
});

describe('generateSlots boundaries', () => {
  test('a closed weekday yields nothing', () => {
    const slots = generateSlots({
      year: 2026, month: 3, day: 8, timeZone: TZ,
      businessHours: weekdaysOnly, durationMinutes: 60, stepMinutes: 60,
    });
    assert.equal(slots.length, 0);
  });

  test('the job plus buffer must fit before closing', () => {
    // 17:30 close, 60 min job => last usable start is 16:30.
    const slots = generateSlots({
      year: 2026, month: 6, day: 10, timeZone: TZ,
      businessHours: alwaysOpen, durationMinutes: 60, stepMinutes: 60,
    });
    assert.equal(localTime(slots[slots.length - 1]!.start), '16:00');
    assert.ok(slots.every((s) => s.end.getTime() <= new Date('2026-06-10T21:30:00.000Z').getTime()));
  });

  test('non-positive duration yields nothing', () => {
    const slots = generateSlots({
      year: 2026, month: 6, day: 10, timeZone: TZ,
      businessHours: alwaysOpen, durationMinutes: 0, stepMinutes: 60,
    });
    assert.equal(slots.length, 0);
  });
});

describe('weekdayFor', () => {
  test('is computed from the calendar date, not the clock offset', () => {
    assert.equal(weekdayFor(2026, 3, 8), 0);  // Sunday
    assert.equal(weekdayFor(2026, 11, 1), 0); // Sunday
    assert.equal(weekdayFor(2026, 6, 10), 3); // Wednesday
  });
});
