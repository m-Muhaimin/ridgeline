import type { Interval } from './timezone.js';

/**
 * Conflict primitives. All intervals are half-open `[start, end)` so that an
 * appointment ending at 11:00 and one starting at 11:00 do NOT overlap.
 * This is the rule the database exclusion constraint also encodes.
 */

export type BusyInterval = Interval & {
  bookingId?: string;
  status?: string;
};

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Widen an interval by `bufferMinutes` on both sides. */
export function expandInterval(interval: Interval, bufferMinutes: number): Interval {
  if (!Number.isFinite(bufferMinutes) || bufferMinutes <= 0) return interval;
  const ms = bufferMinutes * 60_000;
  return {
    start: new Date(interval.start.getTime() - ms),
    end: new Date(interval.end.getTime() + ms),
  };
}

/**
 * Every existing booking that collides with `candidate`, honouring the
 * organization's buffer. The candidate itself is widened; the existing
 * bookings are used as-is, so a buffer is counted once rather than twice.
 */
export function findConflicts(
  candidate: Interval,
  busy: BusyInterval[],
  bufferMinutes: number,
): BusyInterval[] {
  const guarded = expandInterval(candidate, bufferMinutes);
  return busy.filter((b) => intervalsOverlap(guarded, b));
}

export function isAvailable(
  candidate: Interval,
  busy: BusyInterval[],
  bufferMinutes: number,
): boolean {
  return findConflicts(candidate, busy, bufferMinutes).length === 0;
}
