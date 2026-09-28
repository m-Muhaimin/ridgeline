import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { intervalsOverlap, findConflicts, expandInterval, isAvailable } from '../conflict.js';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 5, h, m));

describe('interval overlap', () => {
  test('identical intervals conflict', () => {
    assert.equal(intervalsOverlap({ start: at(9), end: at(11) }, { start: at(9), end: at(11) }), true);
  });

  test('partial overlap conflicts', () => {
    assert.equal(intervalsOverlap({ start: at(9), end: at(11) }, { start: at(10), end: at(12) }), true);
  });

  test('containment conflicts', () => {
    assert.equal(intervalsOverlap({ start: at(9), end: at(13) }, { start: at(10), end: at(11) }), true);
  });

  test('adjacent intervals do NOT conflict (half-open)', () => {
    assert.equal(intervalsOverlap({ start: at(9), end: at(11) }, { start: at(11), end: at(13) }), false);
  });
});

describe('buffer enforcement', () => {
  const busy = [{ start: at(11), end: at(13), bookingId: 'b1' }];

  test('slot ending exactly at buffer boundary is allowed', () => {
    const candidate = { start: at(9, 45), end: at(10, 45) };
    assert.equal(isAvailable(candidate, busy, 15), true);
  });

  test('slot one minute inside the buffer is rejected', () => {
    const candidate = { start: at(9, 46), end: at(10, 46) };
    assert.equal(isAvailable(candidate, busy, 15), false);
  });

  test('zero buffer is a no-op', () => {
    const interval = { start: at(9), end: at(11) };
    assert.deepEqual(expandInterval(interval, 0), interval);
    assert.deepEqual(expandInterval(interval, -5), interval);
  });

  test('reports the conflicting booking', () => {
    const hits = findConflicts({ start: at(10), end: at(12) }, busy, 15);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].bookingId, 'b1');
  });
});
