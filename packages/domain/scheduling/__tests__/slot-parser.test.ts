import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlotString, parseTimeOfDay, minutesToLabel } from '../slot-parser.js';

describe('time-of-day parsing', () => {
  test('12-hour forms', () => {
    assert.equal(parseTimeOfDay('09:00 AM'), 540);
    assert.equal(parseTimeOfDay('11:15 AM'), 675);
    assert.equal(parseTimeOfDay('01:45 PM'), 825);
    assert.equal(parseTimeOfDay('12:00 AM'), 0);
    assert.equal(parseTimeOfDay('12:00 PM'), 720);
  });

  test('24-hour form', () => {
    assert.equal(parseTimeOfDay('14:30'), 870);
  });

  test('rejects garbage', () => {
    assert.equal(parseTimeOfDay('sometime'), null);
    assert.equal(parseTimeOfDay('09:75 AM'), null);
    assert.equal(parseTimeOfDay(''), null);
  });
});

describe('legacy slot strings', () => {
  test('clean range from production data', () => {
    assert.deepEqual(parseSlotString('09:00 AM - 11:00 AM'), {
      startMinute: 540, endMinute: 660, dayHint: null,
    });
  });

  test('recoverable corrupted value with leaked day prefix', () => {
    assert.deepEqual(parseSlotString('Tomorrow 09:00 AM - 11:00 AM'), {
      startMinute: 540, endMinute: 660, dayHint: 'tomorrow',
    });
  });

  test('handles buffer-aware and en-dash variants', () => {
    assert.deepEqual(parseSlotString('11:15 AM - 01:45 PM'), {
      startMinute: 675, endMinute: 825, dayHint: null,
    });
    assert.deepEqual(parseSlotString('08:30 AM – 10:30 AM'), {
      startMinute: 510, endMinute: 630, dayHint: null,
    });
  });

  test('rejects end before start and malformed input', () => {
    assert.equal(parseSlotString('11:00 AM - 09:00 AM'), null);
    assert.equal(parseSlotString('09:00 AM'), null);
    assert.equal(parseSlotString('whenever'), null);
  });

  test('label round-trip', () => {
    assert.equal(minutesToLabel(540), '9:00 AM');
    assert.equal(minutesToLabel(825), '1:45 PM');
    assert.equal(minutesToLabel(0), '12:00 AM');
  });
});
