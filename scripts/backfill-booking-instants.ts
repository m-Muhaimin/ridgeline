/**
 * Backfill authoritative booking instants for legacy rows.
 *
 * Run BEFORE (and only after) each organization's `timezone` is correct: the
 * `time_slot` text is a wall-clock time, and interpreting it in the wrong zone
 * is the exact bug this column set exists to prevent. Once a row is backfilled
 * it is a constraint-enforced fact, so a zone change afterwards will NOT
 * silently rewrite it — re-run with --force to deliberately recompute.
 *
 *   npx tsx scripts/backfill-booking-instants.ts           # dry run (default)
 *   npx tsx scripts/backfill-booking-instants.ts --apply    # write, one txn
 *   npx tsx scripts/backfill-booking-instants.ts --apply --force
 *
 * Only rows with `scheduled_start IS NULL` are touched, so bookings written by
 * the conflict-checked service keep the instants they were created with.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { Pool } from '@neondatabase/serverless';
import { parseSlotString, stripDayQualifier } from '../packages/domain/scheduling/slot-parser.js';
import { zonedTimeToUtc, zonedParts, isValidTimeZone } from '../packages/domain/scheduling/timezone.js';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type YMD = { y: number; m: number; d: number };

/**
 * Next Mon–Fri day strictly after the given date. Deliberately weekday-only:
 * there is no holiday calendar in this codebase, and inventing one silently
 * would be worse than skipping a Saturday.
 */
function nextBusinessDay(from: YMD): YMD & { dow: string } {
  const t = new Date(Date.UTC(from.y, from.m - 1, from.d));
  do {
    t.setUTCDate(t.getUTCDate() + 1);
  } while (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: DOW[t.getUTCDay()]! };
}

function ymdToDb(d: YMD): string {
  return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
}

function localLabel(iso: string, zone: string): string {
  const p = zonedParts(new Date(iso), zone);
  const dow = DOW[zonedParts(new Date(iso), zone).weekday === 0 ? 0 : new Date(iso).getUTCDay()]!;
  return `${ymdToDb({ y: p.year, m: p.month, d: p.day })} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} ${dow}`;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const c = await pool.connect();
  const warnings: string[] = [];

  try {
    const where = FORCE ? '' : 'AND b.scheduled_start IS NULL';
    const { rows } = await c.query(`
      SELECT b.id, b.organization_id, o.name AS org, o.timezone, b.status,
             b.scheduled_date, b.time_slot, b.created_at, b.customer_name
      FROM public.job_bookings b
      JOIN public.organizations o ON o.id = b.organization_id
      WHERE TRUE ${where}
      ORDER BY b.created_at ASC`);

    if (rows.length === 0) {
      console.log(APPLY ? 'Nothing to backfill — every booking already has authoritative instants.' : 'Nothing to backfill (dry run).');
      return;
    }

    const plan: any[] = [];
    for (const r of rows) {
      const zone = r.timezone || 'UTC';
      if (!isValidTimeZone(zone)) {
        warnings.push(`org "${r.org}" has invalid timezone ${JSON.stringify(zone)} — row skipped`);
        continue;
      }
      const parsed = parseSlotString(r.time_slot);
      if (!parsed) {
        warnings.push(`row ${r.id} (${r.customer_name}): unparseable time_slot ${JSON.stringify(r.time_slot)} — skipped`);
        continue;
      }

      const sd = r.scheduled_date instanceof Date ? r.scheduled_date.toISOString().slice(0, 10) : String(r.scheduled_date);
      const createdLocal = zonedParts(new Date(r.created_at), zone);
      let date: YMD = { y: Number(sd.slice(0, 4)), m: Number(sd.slice(5, 7)), d: Number(sd.slice(8, 10)) };
      let rule = 'scheduled_date as stored';

      if (parsed.dayHint === 'tomorrow') {
        const nb = nextBusinessDay({ y: createdLocal.year, m: createdLocal.month, d: createdLocal.day });
        date = nb;
        rule = `dayHint "tomorrow" -> next business day after created_at in ${zone} (${nb.dow})`;
      } else if (parsed.dayHint === 'today') {
        date = { y: createdLocal.year, m: createdLocal.month, d: createdLocal.day };
        rule = `dayHint "today" -> created_at's local date in ${zone}`;
      }

      const start = zonedTimeToUtc(date.y, date.m, date.d, 0, parsed.startMinute, zone);
      const end = zonedTimeToUtc(date.y, date.m, date.d, 0, parsed.endMinute, zone);
      if (end <= start) throw new Error(`row ${r.id}: end ${end.toISOString()} <= start ${start.toISOString()}`);

      plan.push({
        id: r.id, org: r.org, zone, status: r.status, customer: r.customer_name,
        oldText: r.time_slot, oldDate: sd, rule,
        start, end,
        newDate: ymdToDb(date),
        // Strip only the day-qualifier. The row now carries an absolute
        // scheduled_date, so "Tomorrow 09:00 AM" is actively misleading. The
        // rest of the text is left byte-for-byte alone: re-rendering it would
        // rewrite "08:30 AM" as "8:30 AM" in rows that were never wrong.
        newText: stripDayQualifier(r.time_slot) ?? r.time_slot,
      });
    }

    console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${plan.length} booking(s) in ${new Set(plan.map(p => p.org)).size} org(s)\n`);
    for (const p of plan) {
      console.log(`  ${p.org} / ${p.customer} [${p.status}]  tz=${p.zone}`);
      console.log(`    text   "${p.oldText}"  on ${p.oldDate}`);
      console.log(`    rule   ${p.rule}`);
      console.log(`    ->     ${p.start.toISOString()} .. ${p.end.toISOString()}`);
      console.log(`    local  ${localLabel(p.start.toISOString(), p.zone)} -> ${localLabel(p.end.toISOString(), p.zone)}`);
      console.log(`    cols   scheduled_date=${p.oldDate}->${p.newDate}  time_slot="${p.oldText}"->"${p.newText}"`);
    }

    for (const w of warnings) console.log(`\n  WARNING: ${w}`);
    if (!APPLY) {
      console.log(`\nDry run only. Re-run with --apply to write.`);
      return;
    }

    await c.query('BEGIN');
    let written = 0;
    for (const p of plan) {
      await c.query(
        `UPDATE public.job_bookings
            SET scheduled_start = $1, scheduled_end = $2, scheduled_date = $3, time_slot = $4, updated_at = NOW()
          WHERE id = $5`,
        [p.start.toISOString(), p.end.toISOString(), p.newDate, p.newText, p.id]
      );
      written++;
    }
    const check = await c.query(
      `SELECT count(*)::int AS n FROM public.job_bookings
        WHERE scheduled_start IS NOT NULL AND (scheduled_end <= scheduled_start)`);
    if (check.rows[0].n > 0) throw new Error(`constraint precondition failed: ${check.rows[0].n} inverted ranges`);
    await c.query('COMMIT');
    console.log(`\nCommitted ${written} booking(s) in one transaction.`);
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* connection may be gone */ }
    console.error(`\nRolled back. ${(err as Error).message}`);
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch(() => process.exit(1));
