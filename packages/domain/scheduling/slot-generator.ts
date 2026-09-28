import { zonedTimeToUtc, type Interval } from './timezone.js';

export type BusinessHours = {
  /** 0 = Sunday ... 6 = Saturday. Missing weekday = closed. */
  perWeekday: Record<number, { startMinute: number; endMinute: number } | null>;
};

export type GenerateSlotsInput = {
  year: number;
  month: number;
  day: number;
  timeZone: string;
  businessHours: BusinessHours;
  durationMinutes: number;
  stepMinutes: number;
};

/**
 * Every candidate start time inside a day's working window.
 * A slot is only emitted when the whole job plus its trailing buffer
 * still fits before the day closes.
 */
export function generateSlots(input: GenerateSlotsInput): Interval[] {
  const { year, month, day, timeZone, businessHours, durationMinutes, stepMinutes } = input;
  if (durationMinutes <= 0) return [];
  const step = stepMinutes > 0 ? stepMinutes : durationMinutes;

  const weekday = weekdayFor(year, month, day);
  const window = businessHours.perWeekday[weekday];
  if (!window) return [];

  const slots: Interval[] = [];
  for (let m = window.startMinute; m + durationMinutes <= window.endMinute; m += step) {
    // Each start is resolved through the zone rather than by adding minutes to
    // local midnight. On a DST transition day the UTC offset changes mid-day,
    // so midnight + 7h lands on 08:00 instead of 07:00. The end is absolute
    // elapsed time, so a job is always exactly `durationMinutes` long.
    const start = zonedTimeToUtc(year, month, day, 0, m, timeZone);
    slots.push({ start, end: new Date(start.getTime() + durationMinutes * 60_000) });
  }
  return slots;
}

/** 0 = Sunday. Computed in UTC from the calendar date, which is DST-safe
 *  because the weekday of a date does not depend on the clock offset. */
export function weekdayFor(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
