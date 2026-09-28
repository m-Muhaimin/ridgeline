# Task 2 — Remove the unknown-Twilio-number fallback (Sprint 3, item 3.1)

## Goal
Stop resolving an incoming webhook for an unrecognized Twilio number to "whatever org exists".
The DB lookup no longer falls back to `ORDER BY created_at LIMIT 1`, no route falls back to
`inMemoryOrgs[0]`, and no voice call silently forwards to `FORWARD_CALLS_TO` for an unknown org.
Unknown number → webhook answers deterministically ("offline" reply / hangup) and logs a warning.

## Files
- **Create** `packages/domain/organizations/twilio-phone.ts`
- **Create** `packages/domain/organizations/__tests__/twilio-phone.test.ts`
- **Edit** `server.ts`:
  - `normalizePhone` (currently ~line 2218) — delete, re-exported from the new module
  - `findOrgByTwilioNumber` (~2224-2249) — delete fallbacks
  - SMS webhook `if (!org)` branch (~2591-2610) — add the "offline" reply
  - Voice webhook `if (!org || !org.forward_calls_to)` branch (~2914-2927) — hard-stop instead of env fallback
  - Voice-status handler (~2930-3010) — default to `null` org, run nothing, return 200 XML

## Design decisions (already made)
- None of the three in-memory fallbacks survive. `findOrgByTwilioNumber` returns `match` or `null`.
- The shared matcher lives in `packages/domain/organizations/twilio-phone.ts` following the existing
  pure-module pattern (`packages/domain/conversations/policy-engine.ts`). Import style: from `server.ts`
  use `'./packages/domain/organizations/twilio-phone.js'`, from tests use relative paths.
- `FORWARD_CALLS_TO` no longer functions as a catch-all routing target; it still exists as the
  per-org voice forwarding destination (`org.forward_calls_to`) — that use is unchanged.
- Reply strings below are exact — do not reword.

## Exact code — `packages/domain/organizations/twilio-phone.ts`
```ts
export function normalizePhone(p?: string | null): string {
  if (!p) return '';
  // Copy the exact body of the current normalizePhone in server.ts (digits-only, strips
  // non-numeric chars). Preserve its current regex/trim behavior verbatim.
}

export type OrgWithPhone = {
  id: string;
  twilioPhoneNumber?: string | null;
  twilio_phone_number?: string | null;
};

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
```
(Copy the `normalizePhone` body from the current server.ts before deleting it there — no behavior change.)

## `server.ts` edits
1. Add import: `import { findOrgByTwilioNumber, normalizePhone } from './packages/domain/organizations/twilio-phone.js';`
2. Remove the local `normalizePhone` and rewrite `findOrgByTwilioNumber` to:
   ```ts
   async function findOrgByTwilioNumber(twilioNumber?: string) {
     const normalized = normalizePhone(twilioNumber);
     if (!normalized) return null;
     if (pool) {
       const result = await pool.query(
         `SELECT * FROM public.organizations WHERE twilio_phone_number = $1 LIMIT 1`,
         [normalized],
       );
       if (result.rows.length > 0) return result.rows[0];
     }
     return findOrgByTwilioNumber(inMemoryOrgs, normalized);
   }
   ```
   Delete the `ORDER BY created_at ASC LIMIT 1` fallback block and the `|| inMemoryOrgs[0]` in the
   in-memory path.
3. SMS webhook (currently at the `if (!org) { ... }` inside `/webhooks/twilio/sms`, ~line 2608):
   replace the existing fallback content with:
   ```ts
   if (!org) {
     console.warn('No organization found for Twilio number:', to);
     const twiml = new MessagingResponse();
     twiml.message('RidgeLine Dispatch: this number is not currently connected to a dispatch line. Please try again later.');
     return res.type('text/xml').send(twiml.toString());
   }
   ```
4. Voice webhook (`/webhooks/twilio/voice`): where the code currently resolves `org` and falls back
   to `FORWARD_CALLS_TO`, change to:
   ```ts
   const org = await findOrgByTwilioNumber(fromNumber ?? req.body.To);
   if (!org || !org.forward_calls_to) {
     console.warn('No forwardable organization for Twilio number:', req.body.To, '(org found:', !!org, ')');
     const voiceResponse = new VoiceResponse();
     voiceResponse.reject();
     return res.type('text/xml').send(voiceResponse.toString());
   }
   ```
   Keep the `dial` block that forwards to `org.forward_calls_to` exactly as it is once `org` is known.
5. Voice-status handler: replace `const orgId = org?.id || inMemoryOrgs[0].id;` and the surrounding
   `org?.id` fallback with a `const orgId = org?.id ?? null;` style — and gate the entire
   missed-call/SMS/insert block on `org` being present:
   ```ts
   if (!org) {
     console.warn('Voice status for unknown organization, call:', callSid, 'status:', dialStatus);
     return res.type('text/xml').send(new VoiceResponse().toString());
   }
   ```
   Place this immediately after the handler's early `dialStatus === 'completed'` return. All later
   references to `orgId`/`org` in this handler then operate on the definite org. Do not restructure
   the DB block in this task (that's Task 5/7) — just remove the `inMemoryOrgs[0]` fallback.

## Tests — `packages/domain/organizations/__tests__/twilio-phone.test.ts`
1. `normalizePhone('+1 (555) 123-4567')` equals `normalizePhone('15551234567')` (formatting-agnostic).
2. `normalizePhone(undefined)` and `normalizePhone(null)` return `''`.
3. `findOrgByTwilioNumber([{ id: 'a', twilioPhoneNumber: '+15551234567' }], '15551234567')` returns org `'a'`.
4. `findOrgByTwilioNumber([{ id: 'a', twilio_phone_number: '15551234567' }], '+1 (555) 123-4567')` returns org `'a'` (snake_case column shape + formatted input).
5. **No fallback:** `findOrgByTwilioNumber([{ id: 'a', twilioPhoneNumber: '+19999999999' }], '15551234567')` returns `null`.
6. `findOrgByTwilioNumber([], '+15551234567')` returns `null`; `findOrgByTwilioNumber([{ id: 'a' }], undefined)` returns `null`.

## Verification
```bash
npx tsc --noEmit
npm test
```
Manual: `grep -n "FORWARD_CALLS_TO" server.ts` → only the const declaration and its use as `org.forward_calls_to`/env default should remain; `grep -n "inMemoryOrgs\[0\]" server.ts` must return nothing.

## Where it fits
Part of Sprint 3 item 3.1 (removes the silent identity fallback so webhooks are deterministic before
idempotency work lands); Task 5 edits the same voice-status handler afterward.