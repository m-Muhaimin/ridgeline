/**
 * Booking and scheduling operations, in one place.
 *
 * This block used to sit in `server.ts` as free functions taking a `PoolClient`,
 * which meant the booking rules were only reachable by booting the whole server
 * and could not be tested without a live database. They now sit behind a
 * `Queryable` port: the SQL and the business rules are here, the driver is
 * supplied by the caller, and a test can hand in a fake.
 *
 * The interval, buffer and conflict maths stay in `packages/domain/scheduling`
 * as pure functions. This layer owns the SQL.
 *
 * Every write still requires a caller-owned transaction; the exclusion
 * constraint on `job_bookings` is the last line of defence.
 */
import {
  availableSlots, findConflicts, generateSlots, intervalLabel, parseSlotString,
  stripDayQualifier, zonedParts, zonedTimeToUtc,
  type BusyInterval, type Interval, type BusinessHours,
} from '../domain/scheduling/index.js';

/** The slice of a Postgres driver this module needs. Satisfied by Pool and PoolClient. */
export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

// --- Scheduling truth ------------------------------------------------------
// A booking is only ever written through createBookingChecked, so no code path
// can create an overlapping visit. The interval and buffer rules are pure
// functions in packages/domain/scheduling (unit tested); this block owns the
// SQL and relies on the caller for the transaction boundary.

export type SlotConflict = {
  id?: string;
  customerName?: string;
  start: string;
  end: string;
};

export class SlotUnavailableError extends Error {
  conflicts: SlotConflict[];
  constructor(conflicts: SlotConflict[]) {
    super(
      `Requested slot conflicts with ${conflicts.length} existing booking(s): ` +
        conflicts
          .map((c) => (c.customerName ? `${c.customerName} at ${c.start}` : `a booking at ${c.start}`))
          .join('; '),
    );
    this.name = 'SlotUnavailableError';
    this.conflicts = conflicts;
  }
}

export class UnparseableSlotError extends Error {
  constructor(slot: string | null | undefined) {
    super(
      slot
        ? `Cannot interpret slot "${slot}". Expected a range such as "09:00 AM - 11:00 AM".`
        : 'A time slot is required, e.g. "09:00 AM - 11:00 AM".',
    );
    this.name = 'UnparseableSlotError';
  }
}

/** Turn a stored date + free-text slot into real UTC instants. */
export function resolveBookingInterval(
  date: string,
  timeSlot: string | null | undefined,
  timeZone: string,
): { start: Date; end: Date } | null {
  const parsed = parseSlotString(timeSlot);
  if (!parsed) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''));
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!month || !day) return null;
  const start = zonedTimeToUtc(year, month, day, Math.floor(parsed.startMinute / 60), parsed.startMinute % 60, timeZone);
  const end = zonedTimeToUtc(year, month, day, Math.floor(parsed.endMinute / 60), parsed.endMinute % 60, timeZone);
  if (!(end > start)) return null;
  return { start, end };
}

/** Today in the organization's zone. Using UTC here would book New York
 *  customers onto tomorrow whenever they write after 4pm local. */
export function localDateInZone(timeZone: string, now: Date = new Date()): string {
  const p = zonedParts(now, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export type SchedulingPolicy = {
  timeZone: string;
  bufferMinutes: number;
  businessHours: BusinessHours;
  workWeekends: boolean;
  minLeadTimeHours: number;
};

/** A Postgres `TIME` ("07:30:00") as minutes past local midnight. */
export function timeColumnToMinutes(value: unknown): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export const DEFAULT_WORK_START_MIN = 7 * 60 + 30;
export const DEFAULT_WORK_END_MIN = 17 * 60 + 30;
/** Nobody wants a van dispatched for "in 20 minutes", and the plan is unusable
 *  without a floor. Overridable per organization later. */
export const DEFAULT_MIN_LEAD_HOURS = 2;
/** Step between candidate starts. */
export const SLOT_STEP_MINUTES = 30;
export const DEFAULT_MAX_ADVANCE_DAYS = 14;

export async function loadSchedulingPolicy(
  db: Queryable,
  orgId: string,
): Promise<SchedulingPolicy> {
  const { rows } = await db.query(
    `SELECT o.timezone,
            COALESCE(s.buffer_minutes_between_jobs, 45) AS buffer_minutes,
            s.working_hours_start,
            s.working_hours_end,
            COALESCE(s.work_weekends, false) AS work_weekends
       FROM public.organizations o
       LEFT JOIN public.assistant_settings s ON s.organization_id = o.id
      WHERE o.id = $1`,
    [orgId],
  );
  if (rows.length === 0) throw new Error(`Organization ${orgId} not found`);
  const row = rows[0];
  const startMin = timeColumnToMinutes(row.working_hours_start);
  const endMin = timeColumnToMinutes(row.working_hours_end);
  let startMinute = Number.isFinite(startMin) ? startMin : DEFAULT_WORK_START_MIN;
  let endMinute = Number.isFinite(endMin) && endMin > startMinute ? endMin : DEFAULT_WORK_END_MIN;
  if (endMinute <= startMinute) {
    // A stored window that cannot hold a single job -- "17:30 to 07:30", or a
    // close that is not after the open -- would leave this organization with
    // zero openings forever, and every booking request rejected as "outside
    // working hours" with nothing to look at. Treat the pair as misconfigured
    // and serve a real day instead of an empty one.
    startMinute = DEFAULT_WORK_START_MIN;
    endMinute = DEFAULT_WORK_END_MIN;
  }
  const workWeekends = row.work_weekends === true;
  const perWeekday: Record<number, { startMinute: number; endMinute: number } | null> = {};
  for (let day = 0; day < 7; day++) {
    const weekend = day === 0 || day === 6;
    perWeekday[day] = weekend && !workWeekends ? null : { startMinute, endMinute };
  }
  return {
    timeZone: row.timezone || 'UTC',
    bufferMinutes: Number(row.buffer_minutes) || 0,
    businessHours: { perWeekday },
    workWeekends,
    minLeadTimeHours: DEFAULT_MIN_LEAD_HOURS,
  };
}

/**
 * Bookings that occupy the schedule. Mirrors the predicate in the
 * `job_bookings_no_active_overlap` exclusion constraint, so an offer is never
 * made for a window the database would then reject.
 */
export async function loadBusyIntervals(
  db: Queryable,
  orgId: string,
): Promise<BusyInterval[]> {
  const { rows } = await db.query(
    `SELECT b.id, b.scheduled_start, b.scheduled_end, b.customer_name
       FROM public.job_bookings b
      WHERE b.organization_id = $1
        AND b.status = ANY($2::booking_status[])
        AND b.scheduled_start IS NOT NULL
        AND b.scheduled_end IS NOT NULL`,
    [orgId, ['scheduled', 'en_route', 'in_progress']],
  );
  return rows.map((r) => ({
    start: new Date(r.scheduled_start),
    end: new Date(r.scheduled_end),
    bookingId: r.id ?? undefined,
    customerName: r.customer_name ?? undefined,
  }));
}

export type SlotOffer = { interval: Interval; label: string; date: string };

/**
 * Genuine openings for a service, from real working hours, real bookings and
 * the real buffer. This is the only thing allowed to produce a time the
 * assistant may offer or book -- never a hardcoded literal.
 */
export async function proposeAvailableSlots(
  db: Queryable,
  orgId: string,
  opts: { durationMinutes: number; now?: Date; limit?: number; maxAdvanceDays?: number },
): Promise<SlotOffer[]> {
  const policy = await loadSchedulingPolicy(db, orgId);
  const busy = await loadBusyIntervals(db, orgId);
  const slots = availableSlots({
    now: opts.now ?? new Date(),
    timeZone: policy.timeZone,
    businessHours: policy.businessHours,
    durationMinutes: opts.durationMinutes,
    stepMinutes: SLOT_STEP_MINUTES,
    bufferMinutes: policy.bufferMinutes,
    busy,
    minLeadTimeHours: policy.minLeadTimeHours,
    maxAdvanceDays: opts.maxAdvanceDays ?? DEFAULT_MAX_ADVANCE_DAYS,
  });
  return slots.slice(0, opts.limit ?? 3).map((interval) => ({
    interval,
    label: intervalLabel(interval, policy.timeZone),
    date: localDateInZone(policy.timeZone, interval.start),
  }));
}

/** Service duration drives slot width; fall back to a typical diagnostic. */
export const DEFAULT_SERVICE_MINUTES = 120;

export function resolveServiceDuration(
  serviceTitle: string | null | undefined,
  services: Array<{ title?: string; durationHours?: number | string }>,
): number {
  if (serviceTitle && services.length) {
    const want = serviceTitle.toLowerCase();
    const hit =
      services.find((sv) => (sv.title || '').toLowerCase() === want) ||
      services.find((sv) => (sv.title || '').toLowerCase().includes(want) || want.includes((sv.title || '').toLowerCase()));
    const hours = hit ? Number(hit.durationHours) : NaN;
    if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  }
  return DEFAULT_SERVICE_MINUTES;
}

/** Is this instant inside the organization's working window for its weekday? */
export function withinBusinessHours(instant: Date, end: Date, policy: SchedulingPolicy): boolean {
  const p = zonedParts(instant, policy.timeZone);
  const window = policy.businessHours.perWeekday[p.weekday];
  if (!window) return false;
  const startMinute = p.hour * 60 + p.minute;
  const endMinute = startMinute + Math.round((end.getTime() - instant.getTime()) / 60_000);
  return startMinute >= window.startMinute && endMinute <= window.endMinute;
}

export type ResolvedSlot = { date: string; timeSlot: string; label: string; interval: Interval };

/**
 * Turn a customer-stated time into a real, free, bookable interval.
 *
 * Searches forward for the first day the customer could actually have meant,
 * honouring an explicit "today"/"tomorrow" and the working window. When no day
 * works, real alternatives are offered instead. There is no branch here that
 * produces a time nobody asked for.
 */
export async function resolveRequestedSlot(
  db: Queryable,
  orgId: string,
  requestedSlot: string | null,
  durationMinutes: number,
  policy: SchedulingPolicy,
  now: Date = new Date(),
): Promise<{ match: ResolvedSlot | null; offers: SlotOffer[] }> {
  const parsed = parseSlotString(requestedSlot);
  if (!parsed) {
    return { match: null, offers: await proposeAvailableSlots(db, orgId, { durationMinutes, now }) };
  }
  const busy = await loadBusyIntervals(db, orgId);
  const earliest = now.getTime() + policy.minLeadTimeHours * 3_600_000;
  // An explicit "tomorrow" must not be satisfied by today.
  const firstDay = parsed.dayHint === 'tomorrow' ? 1 : 0;

  for (let i = firstDay; i < firstDay + DEFAULT_MAX_ADVANCE_DAYS; i++) {
    const cursor = new Date(now.getTime() + i * 86_400_000);
    const date = localDateInZone(policy.timeZone, cursor);
    const interval = resolveBookingInterval(date, requestedSlot, policy.timeZone);
    if (!interval) continue;
    if (interval.start.getTime() < earliest) continue;
    if (!withinBusinessHours(interval.start, interval.end, policy)) continue;
    if (findConflicts(interval, busy, policy.bufferMinutes).length > 0) continue;
    return {
      match: {
        date,
        timeSlot: stripDayQualifier(requestedSlot) || intervalLabel(interval, policy.timeZone),
        label: intervalLabel(interval, policy.timeZone),
        interval,
      },
      offers: [],
    };
  }
  return { match: null, offers: await proposeAvailableSlots(db, orgId, { durationMinutes, now }) };
}

/** Human reply built only from openings that already passed the conflict check. */
export function composeOfferReply(offers: SlotOffer[], timeZone: string, lead = 'Which of these suits you'): string {
  if (offers.length === 0) {
    return 'I could not find an open slot soon. Let me have the technician call you to find a time.';
  }
  const listed = offers
    .slice(0, 3)
    .map((o) => {
      const parts = zonedParts(o.interval.start, timeZone);
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parts.weekday];
      return `${day} ${o.label}`;
    })
    .join(' | ');
  return `I can do ${listed}. ${lead}?`;
}

/**
 * Reject the candidate if it collides with an active booking, honouring the
 * organization's buffer. Rows without timestamps are legacy rows that predate
 * the scheduling migration and cannot be compared, so they are ignored.
 */
export async function assertSlotAvailable(
  db: Queryable,
  orgId: string,
  interval: { start: Date; end: Date },
  bufferMinutes: number,
  excludeBookingId?: string,
): Promise<void> {
  const { rows } = await db.query(
    `SELECT id, customer_name, scheduled_start, scheduled_end
       FROM public.job_bookings
      WHERE organization_id = $1
        AND status IN ('scheduled', 'en_route', 'in_progress')
        AND scheduled_start IS NOT NULL
        AND scheduled_end > $2::timestamptz - INTERVAL '1 day'
        AND scheduled_start < $3::timestamptz + INTERVAL '1 day'`,
    [orgId, interval.start, interval.end],
  );
  const hits = findConflicts(
    interval,
    rows
      .filter((r: any) => r.id !== excludeBookingId)
      .map((r: any) => ({
        start: new Date(r.scheduled_start),
        end: new Date(r.scheduled_end),
        bookingId: r.id as string | undefined,
        customerName: r.customer_name as string | undefined,
      })),
    bufferMinutes,
  );
  if (hits.length > 0) {
    throw new SlotUnavailableError(
      hits.map((h) => ({
        id: h.bookingId,
        customerName: h.customerName,
        start: h.start.toISOString(),
        end: h.end.toISOString(),
      })),
    );
  }
}

export type CreateBookingInput = {
  customerName: string;
  customerPhone: string;
  address: string;
  tradeType: string;
  serviceTitle: string;
  serviceId?: string | null;
  date: string;
  timeSlot: string | null | undefined;
  status?: string;
  estimateAmount?: number;
  notes?: string;
  urgency?: string;
  createdFrom?: string;
  smsThreadId?: string | null;
};

/**
 * Conflict-checked, timestamp-backed booking insert. MUST run inside a
 * transaction that the caller owns; the exclusion constraint on
 * job_bookings is the last line of defence against a concurrent writer.
 */
export async function createBookingChecked(db: Queryable, orgId: string, input: CreateBookingInput) {
  const policy = await loadSchedulingPolicy(db, orgId);
  const interval = resolveBookingInterval(input.date, input.timeSlot, policy.timeZone);
  if (!interval) throw new UnparseableSlotError(input.timeSlot);

  await assertSlotAvailable(db, orgId, interval, policy.bufferMinutes);

  const { rows } = await db.query(
    `INSERT INTO public.job_bookings (
       organization_id, customer_name, customer_phone, address, trade_type, service_id,
       service_title, scheduled_date, time_slot, status, estimate_amount,
       notes, urgency, created_from, sms_thread_id, scheduled_start, scheduled_end, timezone
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      orgId,
      input.customerName,
      input.customerPhone,
      input.address,
      input.tradeType,
      input.serviceId ?? null,
      input.serviceTitle,
      input.date,
      input.timeSlot,
      input.status || 'scheduled',
      input.estimateAmount ?? 0,
      input.notes ?? '',
      input.urgency || 'routine',
      input.createdFrom || 'manual',
      input.smsThreadId ?? null,
      interval.start,
      interval.end,
      policy.timeZone,
    ],
  );
  return rows[0];
}

/**
 * Move a thread's active bookings to a new slot, keeping the authoritative
 * timestamps in step with scheduled_date / time_slot. A reschedule that
 * would collide is rejected rather than silently double-booking.
 */
/**
 * Cancellation stops the next visit; it does not rewrite history. A job already
 * under way is deliberately left alone: that is a refund conversation, and
 * quietly marking a technician's completed work "cancelled" would hide it.
 */
export async function cancelThreadBookings(db: Queryable, orgId: string, threadId: string): Promise<number> {
  const res = await db.query(
    `UPDATE public.job_bookings
        SET status = 'cancelled',
            notes = CASE WHEN COALESCE(notes, '') = ''
                         THEN 'Cancelled by customer via SMS.'
                         ELSE notes || ' | Cancelled by customer via SMS.' END
      WHERE organization_id = $1 AND sms_thread_id = $2 AND status = 'scheduled'
      RETURNING id;`,
    [orgId, threadId],
  );
  return res.rows?.length || 0;
}

export async function rescheduleThreadBookings(
  db: Queryable,
  orgId: string,
  threadId: string,
  date: string,
  timeSlot: string | null | undefined,
): Promise<number> {
  const policy = await loadSchedulingPolicy(db, orgId);
  const interval = resolveBookingInterval(date, timeSlot, policy.timeZone);
  if (!interval) throw new UnparseableSlotError(timeSlot);

  const { rows } = await db.query(
    `SELECT id FROM public.job_bookings
      WHERE sms_thread_id = $1 AND organization_id = $2
        AND status IN ('scheduled', 'en_route', 'in_progress')
      FOR UPDATE`,
    [threadId, orgId],
  );
  if (rows.length === 0) return 0;

  for (const r of rows) {
    await assertSlotAvailable(db, orgId, interval, policy.bufferMinutes, r.id);
  }

  await db.query(
    `UPDATE public.job_bookings
        SET scheduled_date = $1, time_slot = $2, scheduled_start = $3, scheduled_end = $4,
            notes = notes || ' (Rescheduled via Twilio SMS)', updated_at = NOW()
      WHERE sms_thread_id = $5 AND organization_id = $6`,
    [date, timeSlot, interval.start, interval.end, threadId, orgId],
  );
  return rows.length;
}
