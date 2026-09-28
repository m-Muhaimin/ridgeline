-- Scheduling Truth Engine: real timestamps + database overlap protection.
--
-- Additive only. `scheduled_date` / `time_slot` are left in place so nothing
-- that still reads them breaks. Rows whose timestamps are still NULL are
-- automatically exempt from the exclusion constraint, so legacy bookings
-- (including unparseable ones) can be backfilled afterwards without blocking
-- this migration.

-- gist equality on uuid requires btree_gist.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Organizations gain the wall-clock zone that booking instants are anchored to.
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Real instants. Authoritative once populated.
ALTER TABLE public.job_bookings
    ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scheduled_end   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timezone        TEXT NOT NULL DEFAULT 'UTC';

-- A start must precede its end, and a booking must span a real duration.
ALTER TABLE public.job_bookings
    DROP CONSTRAINT IF EXISTS job_bookings_scheduled_range_valid;
ALTER TABLE public.job_bookings
    ADD CONSTRAINT job_bookings_scheduled_range_valid
    CHECK (scheduled_start IS NULL OR scheduled_end IS NULL OR scheduled_end > scheduled_start);

-- Calendar reads: "everything for this org in this range".
CREATE INDEX IF NOT EXISTS job_bookings_org_start_idx
    ON public.job_bookings (organization_id, scheduled_start);

-- The guarantee: two active bookings for one organization may never overlap.
-- Half-open tstzrange so an 11:00 finish and an 11:00 start are not a conflict.
-- Only the three occupying statuses participate; completed and cancelled rows
-- are outside the predicate and therefore always permitted.
-- The IS NOT NULL guard is required, not decorative: tstzrange(NULL, NULL, '[)')
-- evaluates to an EMPTY range rather than NULL, so un-backfilled legacy rows
-- would otherwise collide with one another and make the constraint
-- uncreatable. The guard also keeps those rows out of the index.
ALTER TABLE public.job_bookings
    DROP CONSTRAINT IF EXISTS job_bookings_no_active_overlap;
ALTER TABLE public.job_bookings
    ADD CONSTRAINT job_bookings_no_active_overlap
    EXCLUDE USING gist (
        organization_id WITH =,
        tstzrange(scheduled_start, scheduled_end, '[)') WITH &&
    )
    WHERE (
        scheduled_start IS NOT NULL
        AND scheduled_end IS NOT NULL
        AND status IN ('scheduled', 'en_route', 'in_progress')
    );

COMMENT ON COLUMN public.job_bookings.scheduled_start IS
    'Authoritative UTC start of the visit. NULL until backfilled from scheduled_date/time_slot.';
COMMENT ON COLUMN public.job_bookings.scheduled_end IS
    'Authoritative UTC end of the visit. NULL until backfilled.';
COMMENT ON COLUMN public.job_bookings.timezone IS
    'IANA zone the customer-facing slot was agreed in, e.g. America/New_York.';
