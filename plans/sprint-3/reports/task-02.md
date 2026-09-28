# Task 2 Report — Remove the unknown-Twilio-number fallback (Sprint 3, item 3.1)

**Status:** complete. `npx tsc --noEmit` exits 0; `npm test` = 118/118 pass, 0 fail.
**Commits:** none — nothing committed, as instructed. Working tree left dirty.

---

## Files changed

| File | Change |
|---|---|
| `packages/domain/organizations/twilio-phone.ts` | **created** — `normalizePhone` (body moved verbatim from `server.ts`), `OrgWithPhone`, pure `findOrgByTwilioNumber(orgs, twilioNumber?)` |
| `packages/domain/organizations/__tests__/twilio-phone.test.ts` | **created** — the brief's 6 cases, `node:test` + `node:assert/strict`, no server/DB/network |
| `server.ts` | **edited** — import, deleted local `normalizePhone`, match-or-null resolver, 3 webhook null-org branches, removed now-dead `FORWARD_CALLS_TO` const |

Not touched (verified): the staged webhook persist block incl. the `"That visit is already under way…"` reply (now at `server.ts:2758`), `packages/domain/conversations/policy-engine.ts` (no unstaged diff), and all of Task 1's `packages/application/tenant-context.ts` work.

---

## Behavioral changes

### `findOrgByTwilioNumber` — match or null, never "some org"

- Early return: an empty/unparseable number yields `null` before any query runs.
- **DB path:** deleted the `SELECT … ORDER BY created_at ASC LIMIT 1` fallback. No match → no row.
- **In-memory path:** the ad-hoc `inMemoryOrgs.find(...) || inMemoryOrgs[0] || null` is now the shared pure matcher, which can only return a match or `null`. `inMemoryOrgs[0]` is gone from the resolver.
- Matching semantics (digits-only compare; camelCase in-memory shape and snake_case row shape both accepted) are unchanged.

### `/webhooks/twilio/sms`

Unknown number → same warn, 200 XML, but the reply is now exactly:
`RidgeLine Dispatch: this number is not previously connected to a dispatch line. Please try again later.`
(verbatim per brief). Nothing is persisted, no thread/customer is created, no LLM call is made.

### `/webhooks/twilio/voice`

Unroutable (no org, **or** org with no `forward_calls_to`/`forwardCallsTo`) → warn + `VoiceResponse.reject()`, 200 XML. The `FORWARD_CALLS_TO` catch-all is gone, so an unknown number can no longer be forwarded to a hardcoded `+15551234567`. The `dial` block (`timeout: 15`, `action: '/webhooks/twilio/voice-status'`, `dial.number(forwardTo)`) is unchanged for a routable call.

### `/webhooks/twilio/voice-status`

`const orgId = org?.id || inMemoryOrgs[0].id` → `const orgId = org.id`, guarded by an early return placed as the first statement of the non-`completed` path (i.e. immediately after the effective `dialStatus === 'completed'` skip). Unknown org → warn (includes `CallSid` + dial status) + empty `VoiceResponse` XML, and **no** outbound auto-SMS, no `missed_calls` insert, no `sms_threads`/`sms_messages` insert. Previously this wrote a caller record and sent a textback into a real, unrelated org.

**Idempotency / retry impact:** the only retry-relevant consequence is that an unknown-number webhook is now a pure no-op read + 200, so a Twilio redelivery is side-effect-free. Task 5/7 own the voice-status DB block; I did not restructure it.

---

## Verification

```
npx tsc --noEmit                 -> exit 0
npm test                         -> tests 118 | suites 12 | pass 118 | fail 0
```

New suite, all 6 pass:
```
✔ normalizePhone ignores formatting, so a dialed number and a stored number agree
✔ normalizePhone treats a missing number as empty rather than throwing
✔ findOrgByTwilioNumber matches the org that owns the number
✔ findOrgByTwilioNumber reads the snake_case row shape and a formatted dialed number
✔ findOrgByTwilioNumber returns null for an unknown number instead of an arbitrary org
✔ findOrgByTwilioNumber returns null for no orgs and for no number
```

Greps:
- `grep -n "ORDER BY created_at LIMIT 1" server.ts` → **no match anywhere.** (`ORDER BY created_at ASC LIMIT 1` survives once at `server.ts:2605`, an unrelated `sms_messages` history query.)
- `grep -n "normalizePhone" server.ts` → **2 hits only**: line 32 (import) and line 2196 (call site). No local function declaration.
- `grep -n "inMemoryOrgs\[0\]" server.ts` → 6 hits remain (lines 650, 896, 977, 1382, 1383, 2267), **none** in `findOrgByTwilioNumber` (2195–2215) or any of the three webhooks. These are pre-existing, unrelated fallbacks (auth org default, demo-org seeding, `inMemorySettings` lookup) and are outside this brief's Files list — see deviation 5.
- `grep -n "FORWARD_CALLS_TO" server.ts` → 1 hit, a comment at line 2885 explaining the removal. The const is deleted — see deviation 4.

---

## Deviations from the brief

All five were forced by the brief's own code not compiling or not running. Each is the smallest change that realizes the brief's stated goal.

1. **Import alias.** The brief has server.ts both import `findOrgByTwilioNumber` from the new module *and* declare a local `async function findOrgByTwilioNumber` that calls it. That is a duplicate identifier in one module scope, and the recursive call would infinitely recurse. I imported it as `findOrgByTwilioNumber as findMatchingOrg` (with a comment saying why) and left the async resolver's name and all three call sites untouched. `normalizePhone` is imported under its own name, per the brief.

2. **Kept the DB matching predicate.** The brief's snippet replaced the query with `WHERE twilio_phone_number = $1` against digits-only `$1`. Every stored value in this repo is formatted — seed/org data is `'+1 (555) 782-4309'` and onboarding writes the user's raw input (`server.ts:1016`, `1976`) — so that predicate can never match and would send *every* DB-backed webhook to the "unknown number" path, i.e. a total webhook outage. I kept the existing `regexp_replace(twilio_phone_number,'[^0-9]','','g') = $1 OR twilio_phone_number = $2` predicate and deleted only the `ORDER BY created_at ASC LIMIT 1` fallback block. This is the actual requirement in the brief's Goal section.

3. **Kept the `try/catch` around the pool query, and kept the `if (pool)` + in-memory tail.** The brief's snippet has neither. Dropping the catch turns a transient DB error in an async Express 4 handler into an unhandled rejection (Express 4 does not catch async throws), and dropping the in-memory tail would make the no-`DATABASE_URL` dev/preview mode unable to route at all. Neither is part of the identity-fallback removal the brief asks for, and the brief explicitly says elsewhere "just remove the `inMemoryOrgs[0]` fallback."

4. **Deleted the `FORWARD_CALLS_TO` const (line 122).** Its only remaining use was the catch-all in the voice handler, so keeping the declaration would be dead code. Consequence to flag: `.env.example:28` still documents `FORWARD_CALLS_TO`, and nothing reads it any more — I left `.env.example` alone because it is not in the brief's Files list.

5. **`inMemoryOrgs[0]` elsewhere in server.ts left in place.** The brief's Manual step says this grep "must return nothing", which is broader than the brief's own Files list (`normalizePhone`, `findOrgByTwilioNumber`, 3 webhooks). The 6 survivors are pre-existing fallbacks in auth/seed/settings paths; removing them is a separate concern and would be scope creep. Flagged rather than done.

Two smaller ones, same category:
- **Voice handler looks up `req.body.To`, not `fromNumber ?? req.body.To`.** There is no `fromNumber` in that handler's scope, and routing on `From` would resolve the *caller's* number instead of the Twilio line being dialed. The brief's snippet appears copy-pasted from another shape; I used `to` (`= req.body.To`), matching the SMS handler and the current code.
- **Guard is `!org || !forwardTo`, not `!org || !org.forward_calls_to`.** `inMemoryOrgs` stores `forwardCallsTo` (camelCase), never `forward_calls_to`, so the brief's literal guard would reject 100% of calls in no-`DATABASE_URL` mode. `forwardTo` is the existing `org?.forward_calls_to || org?.forwardCallsTo` expression with the `|| FORWARD_CALLS_TO` catch-all removed — the same expression, minus the fallback. The warn string is verbatim from the brief (`req.body.To` written as the equivalent `to`).
- Added `const callSid = req.body.CallSid;` to the voice-status handler because the brief's warn line references `callSid` and no such binding existed. It was the only way to keep the exact log line.

---

## For Sentinel / Probe

**Sentinel — audit:**
- No route can still resolve a Twilio number to an org it does not own. The resolver has exactly two exits now: a matching row, or a pure-matcher result.
- No write path is reachable for an unknown number: SMS replies and returns; voice rejects; voice-status returns before the Twilio send and before the `missed_calls` / `sms_threads` / `sms_messages` inserts.
- `FORWARD_CALLS_TO` is no longer read anywhere in the repo's runtime code. `.env.example` still advertises it (dead config line).
- Pre-existing `inMemoryOrgs[0]` fallbacks at 650/896/977/1382/1383/2267 remain — out of scope here, but they are the same class of bug if any of them is reachable from an authenticated or webhook path.

**Probe — test:**
- DB mode, unknown `To` on `/webhooks/twilio/sms` → 200, exact new reply body, zero rows written to `customers`/`sms_threads`/`sms_messages`, no LLM invocation.
- DB mode, known-but-formatted `To` (e.g. `+1 (555) 782-4309` against stored `15557824309`) → still resolves. This is the regression guard for deviation 2; the brief's literal SQL would fail it.
- No-`DATABASE_URL` mode, in-memory org → `/webhooks/twilio/voice` still dials `forwardCallsTo` (guards deviation "guard is `!org || !forwardTo`"); unknown number → `<Reject/>`.
- `/webhooks/twilio/voice-status` with `DialCallStatus=no-answer` and an unknown `To` → empty 200 XML, warn containing `CallSid`, and **no** `twilioClient.messages.create` call and no `missed_calls` row.
- Simulate Twilio redelivery of the same unknown-number SMS/voice-status webhook → identical 200, still no writes.
- `npm test` includes the 6 new `twilio-phone` cases; no test boots the server or touches the DB.
