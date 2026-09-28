# Task 8 — Server-side role authorization (report)

Status: **complete**. No commits made (repo instruction). All four verification gates pass.

## Files changed

| File | Change |
|---|---|
| `packages/domain/organizations/roles.ts` | **Created** — exact code from the brief (`ROLES`, `Role`, `Permission`, `ROLE_PERMISSIONS`, `can`). Pure module, no imports, no I/O, no side effects. |
| `packages/domain/organizations/__tests__/roles.test.ts` | **Created** — 4 `node:test` groups, hermetic (imports only `../roles.js`). |
| `server.ts` | **Edited** — 1 import, `requirePermission` middleware, 13 route annotations. `server.ts` went 2783 → 2801 lines; the +18 is exactly 1 (import) + 15 (comment + middleware block + blank) + 2 (the two multi-line route chains). The other 11 annotations are inline arg inserts, so they add no lines. No existing line was removed or reworded. |
| `src/types.ts` | **Edited** — line 125 `User.role` union widened. |

Not touched: the staged WIP (`packages/domain/conversations/{policy-engine.ts,__tests__/policy-engine.test.ts}`), the Task 1-7 package modules, `server.ts`'s other content, any webhook or route behavior.

## `server.ts` — the 13 route annotations

The brief's line numbers had drifted, so every route was located by its `app.<method>('/api/...')` string. Actual current line numbers:

| # | Route | Line | Permission inserted after `requireAuth` |
|---|---|---|---|
| 1 | `POST /api/customers` | 1343 | `customers.write` |
| 2 | `PATCH /api/customers/:id` | 1401 | `customers.write` |
| 3 | `DELETE /api/customers/:id` | 1438 | `customers.write` |
| 4 | `POST /api/bookings` | 1523 | `bookings.create` |
| 5 | `PATCH /api/bookings/:id` | 1661 | `bookings.update` |
| 6 | `POST /api/sms/message` | 1741 | `sms.send` |
| 7 | `PATCH /api/organizations` | 1861 | `settings.write` |
| 8 | `PATCH /api/assistant-settings` | 1935 | `settings.write` |
| 9 | `POST /api/services` | 2002 | `services.write` |
| 10 | `DELETE /api/services/:id` | 2040 | `services.write` |
| 11 | `POST /api/organizations/switch` | 2063 | `organizations.switch` |
| 12 | `POST /api/sms/process` | 2144 | `assistant.run` |
| 13 | `POST /api/missed-call/process` | 2491 | `assistant.run` |

Import: `server.ts:32` — `import { can, type Permission } from './packages/domain/organizations/roles.js';`
Middleware definition: `server.ts:553-566` (doc comment + `function requirePermission`), immediately after `requireAuth` which ends at 551.

Routes 12 and 13 are the multi-line `app.post(` registrations; their chains are now exactly
`requireAuth, requirePermission('assistant.run'), rateLimitPerOrg({...})` — permission check before the
limiter, per the brief.

## Authorization semantics as built

- Reads are unchanged: any authenticated user of any role may GET. No permission is checked on any GET.
- `requirePermission` reads `req.user.role` (populated by `requireAuth` from the DB row at `server.ts:519-526`
  or the in-memory fallback at `server.ts:537-544`, both of which already carry `role`). No DB access, no
  query, no token decode.
- 401 when `req.user` is missing (defence in depth; `requireAuth` already 401s), 403 with
  `{ error: 'Forbidden: requires <perm> permission.' }` when the role lacks the permission.
- Unknown/legacy role strings fall through `ROLE_PERMISSIONS[role]` to undefined and are denied every write.
  This matters because `users.role` is still a free `VARCHAR` — a stale `'scheduler'` row now denies rather
  than allows.
- No `users.role` column or constraint change, per the brief.
- `/webhooks/*` remain unannotated — they are signature-verified and org-resolved, never user-authed.

## Verification

```
npx tsc --noEmit          -> exit 0   (no output)
npm test                  -> tests 159, suites 12, pass 159, fail 0
                             (baseline was 155; +4 = the new roles test)
npx tsx --test packages/domain/organizations/__tests__/roles.test.ts
                          -> tests 4, pass 4, fail 0
```

Baseline was confirmed clean before any edit (`tsc` exit 0, 155/155), so the 0-exit and 159/159 are
attributable to the new work, not inherited.

Adjacency audit — `grep -A1 requireAuth server.ts` over every `requireAuth` site. The 13 annotated routes
each have `requirePermission('<perm>')` on the line immediately following `requireAuth`. The remaining
`requireAuth` sites are correctly bare:

```
895:  POST /api/auth/complete-onboarding     (no requirePermission — /api/auth/*, excluded)
1119: GET  /api/neon/data                   (GET, excluded)
1323: GET  /api/customers                   (GET, excluded)
1464: GET  /api/availability                (GET, excluded)
2195/2336/2360: /webhooks/twilio/{sms,voice,voice-status}  (no requireAuth at all, untouched)
```

The three `app.post('/webhooks/...` lines are byte-identical to their pre-edit form. `grep -c requirePermission server.ts`
returns **14**. `/api/neon/execute-sql` and `/api/ai/test-endpoint` no longer exist as routes in the current
`server.ts` (removed by earlier sprint work; only a code comment at 2165 references the latter), so there was
nothing there to annotate.

## Deviations

**1. `grep -c "requirePermission" server.ts` is 14, not the 15 the brief predicted.** The brief's arithmetic was
`1 definition + 13 usages + 1 import`, but its own prescribed import line is
`import { can, type Permission } from './packages/domain/organizations/roles.js';` — it does not contain the
string `requirePermission`. `requirePermission` is defined in `server.ts`, not imported. So the true count is
1 definition + 13 usages = 14, and 14 is the correct, complete number. No code change made; this is a
prediction error in the verification step, not a missing import. I left the prescribed import exactly as
written rather than restructuring it to hit an arbitrary count.

**2. One assertion added beyond the brief's spot-check list in test group 2**: `can('', 'bookings.create') === false`.
The brief listed `undefined`, `null`, and `'scheduler'`; `''` is the falsy-string case that reaches the same
`if (!role)` guard as `undefined`/`null`, and it is the one value a `users.role` column can actually hold for
an unset legacy row. Additive only — it cannot mask a defect the brief's assertions would have caught.

No other deviations. The role matrix, the middleware body, the route→permission map, and the `src/types.ts`
union are all verbatim from the brief.

## Notes for Sentinel / Probe

- `src/types.ts` now admits `'admin'` and `'viewer'`, which the client had no union members for. Any
  `switch (user.role)` or role-derived UI in `src/` is now type-checked against a wider set — Probe should
  confirm no client branch assumed a closed 3-member union (e.g. an exhaustive `Record<User['role'], ...>`
  with only 3 keys would now fail `tsc`, which it does not, so this is already type-safe).
- `technician` can now `PATCH /api/bookings/:id` but not `POST /api/bookings`. If any current UI action pairs
  a technician-role user with a booking create, it will start returning 403. There is no role-assignment UI in
  the app (roles come from the DB / registration), so this is a data-dependent risk, not a code one.
- `viewer` is write-denied everywhere. Any seeded or demo user with `role='viewer'` will see a read-only app
  that 403s on every mutation. Worth confirming no seed data uses `viewer` expecting write access.
- The 403 body is `{ error: 'Forbidden: requires <perm> permission.' }`. `apiFetch` surfaces this verbatim,
  so the UI will show that string to users.
- In-memory fallback users (`inMemoryUsers`) carry a `role`; if any of them is `'owner'` or `'admin'` the
  dev no-`DATABASE_URL` path is unaffected. If a fallback user has a legacy/unknown role, dev writes now 403
  where they previously succeeded.
