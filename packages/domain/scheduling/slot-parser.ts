import { zonedParts, type Interval } from './timezone.js';

/**
 * Parses the legacy `job_bookings.time_slot` free-text column.
 *
 * Production contains values such as `"09:00 AM - 11:00 AM"` and the
 * corrupted `"Tomorrow 09:00 AM - 11:00 AM"`, where a display prefix was
 * persisted into the slot column. This parser is what lets those rows be
 * backfilled instead of discarded.
 *
 * It is a migration aid only. New writes must not use free text.
 */

const DAY_PREFIX = /^(today|tomorrow|tmr|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b,?\s*/i;

export function parseTimeOfDay(input: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(input.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = (m[3] || '').toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (meridiem === 'pm' && hour < 12) hour += 12;
  else if (meridiem === 'am' && hour === 12) hour = 0;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

export type ParsedSlot = {
  startMinute: number;
  endMinute: number;
  /** Day-relative qualifier that leaked into the slot text, if any. */
  dayHint: 'today' | 'tomorrow' | null;
};

/** Parse `"Tomorrow 09:00 AM - 11:00 AM"` into minutes-from-midnight. */
export function parseSlotString(input: string | null | undefined): ParsedSlot | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  let text = input.trim();

  let dayHint: ParsedSlot['dayHint'] = null;
  const prefix = DAY_PREFIX.exec(text);
  if (prefix) {
    const word = prefix[1].toLowerCase();
    dayHint = word.startsWith('tom') || word === 'tmr' ? 'tomorrow' : 'today';
    text = text.slice(prefix[0].length);
  }

  // Split on the range separator: dash, en dash, "to".
  const parts = text.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  if (parts.length < 2) return null;

  const startMinute = parseTimeOfDay(parts[0]);
  const endMinute = parseTimeOfDay(parts[parts.length - 1]);
  if (startMinute === null || endMinute === null) return null;
  if (endMinute <= startMinute) return null;

  return { startMinute, endMinute, dayHint };
}

export function minutesToLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  const mm = String(minute).padStart(2, '0');
  return `${display}:${mm} ${meridiem}`;
}

/**
 * Canonical, human-readable label for a confirmed interval, rendered in the
 * organization's own zone.
 *
 * The zone is required rather than defaulted: reading the clock off a UTC
 * instant labels every booking in the wrong timezone, which for a New York
 * shop is four hours off -- the exact confusion this engine exists to remove.
 */
export function intervalLabel(interval: Interval, timeZone: string): string {
  return (
    `${minutesToLabel(localMinutes(interval.start, timeZone))} - ` +
    `${minutesToLabel(localMinutes(interval.end, timeZone))}`
  );
}

function localMinutes(d: Date, timeZone: string): number {
  const p = zonedParts(d, timeZone);
  return p.hour * 60 + p.minute;
}

/**
 * Remove the day-qualifier from slot text, leaving the time range untouched.
 *
 * Used once a row carries an absolute `scheduled_date`: "Tomorrow 09:00 AM" is
 * then actively misleading, because the date has been resolved to a real day.
 * Deliberately surgical — the remainder is preserved byte-for-byte rather than
 * re-rendered, so "08:30 AM" is never rewritten as "8:30 AM".
 */
export function stripDayQualifier(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input.trim().replace(DAY_PREFIX, '').trim();
  return stripped === '' ? input.trim() : stripped;
}
