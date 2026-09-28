/**
 * Which dispatch line is a caller talking to.
 *
 * Previously the webhook resolver in `server.ts` normalised the number, and then —
 * if nothing matched — quietly returned "the first organization that exists"
 * (`ORDER BY created_at ASC LIMIT 1`, or `inMemoryOrgs[0]`). An unrecognized Twilio
 * number therefore became a real customer of a real tradesperson, and its SMS or
 * call was persisted against that org. The matcher now answers one of two things:
 * the org that owns this number, or `null`. Nothing else.
 *
 * Both halves are pure so the routing decision can be tested without a database,
 * a Twilio account or a running server.
 */

export function normalizePhone(p?: string | null): string {
  if (!p) return '';
  return p.replace(/\D/g, '');
}

export type OrgWithPhone = {
  id: string;
  twilioPhoneNumber?: string | null;
  twilio_phone_number?: string | null;
};

/**
 * Returns the org whose Twilio number matches, or `null` when nothing matches.
 * Accepts both the camelCase in-memory shape and the snake_case row shape, and
 * compares digits-only so `+1 (555) 123-4567` and `15551234567` are the same line.
 */
export function findOrgByTwilioNumber(
  orgs: OrgWithPhone[],
  twilioNumber?: string,
): OrgWithPhone | null {
  const normalized = normalizePhone(twilioNumber);
  if (!normalized) return null;
  for (const org of orgs) {
    const candidate = org.twilioPhoneNumber ?? org.twilio_phone_number ?? null;
    if (normalizePhone(candidate) === normalized) return org;
  }
  return null;
}
