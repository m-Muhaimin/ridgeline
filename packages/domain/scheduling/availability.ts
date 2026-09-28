import { findConflicts, type BusyInterval } from './conflict.js';
import { generateSlots, type BusinessHours } from './slot-generator.js';
import { zonedParts, type Interval } from './timezone.js';

export type AvailabilityInput = {
  now: Date;
  timeZone: string;
  businessHours: BusinessHours;
  durationMinutes: number;
  stepMinutes: number;
  bufferMinutes: number;
  busy: BusyInterval[];
  /** Do not offer slots starting sooner than this. */
  minLeadTimeHours: number;
  /** Do not search further out than this. */
  maxAdvanceDays: number;
};

/**
 * The offered slots for the next `maxAdvanceDays`, already filtered against
 * existing bookings, the buffer, and the minimum lead time.
 */
export function availableSlots(input: AvailabilityInput): Interval[] {
  const {
    now, timeZone, businessHours, durationMinutes, stepMinutes,
    bufferMinutes, busy, minLeadTimeHours, maxAdvanceDays,
  } = input;

  const earliest = new Date(now.getTime() + minLeadTimeHours * 3_600_000);
  const out: Interval[] = [];

  // Walk calendar dates instead of adding a fixed 24h to an instant: a DST
  // transition shifts the local hour, which can skip or repeat a date.
  const base = zonedParts(now, timeZone);
  for (let offset = 0; offset <= maxAdvanceDays; offset++) {
    const date = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    for (const slot of generateSlots({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      timeZone,
      businessHours,
      durationMinutes,
      stepMinutes,
    })) {
      if (slot.start < earliest) continue;
      if (findConflicts(slot, busy, bufferMinutes).length > 0) continue;
      out.push(slot);
    }
  }
  return out;
}
