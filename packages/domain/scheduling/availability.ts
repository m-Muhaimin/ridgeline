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

  for (let offset = 0; offset <= maxAdvanceDays; offset++) {
    const cursor = new Date(now.getTime() + offset * 86_400_000);
    const local = zonedParts(cursor, timeZone);
    for (const slot of generateSlots({
      year: local.year,
      month: local.month,
      day: local.day,
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
