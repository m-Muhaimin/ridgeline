# RidgeLine — Sprint 2 cleanup + Sprint 3 (Webhook & Security Hardening)

Implements the remaining Sprint 2 items (2.5 tenant context, 2.3 conversation service) and all of
Sprint 3 from `IMPLEMENTATION.md`. Ten ordered tasks, each one implementer dispatch sized for a
single-pass review. Baseline verified before planning: `npx tsc --noEmit` exits 0, `npm test` green.

## Global Constraints (apply to every task)

1. **Baseline stays green.** After every task: `npx tsc --noEmit` must exit 0 and `npm test` must
   pass. Any new error is yours.
2. **Staged WIP is sacred.** The staged-but-uncommitted cancel/reschedule handling inside the SMS
   webhook persist block (currently `server.ts` ~lines 2775-2842) must be preserved verbatim through
   every refactor. Never revert, never "simplify" it.
3. **New package code follows the existing ESM convention:** relative imports use explicit `.js`
   specifiers (`import { x } from '../domain/scheduling/index.js'`), exactly like
   `packages/application/booking-service.ts`.
4. **New tests** go in `packages/**/__tests__/*.test.ts`, use `node:test` + `node:assert/strict`,
   and exercise code through a fake `Queryable`/`Connectable` port (`{ query(text, params) => ({ rows }) }`
   as in `packages/application/__tests__/booking-service.test.ts`). No server, no database, no network.
5. **Any schema change appears in BOTH `initDb()` inline DDL in `server.ts` AND a new
   `supabase/migrations/*.sql` file** (names sort after `20260928000000_scheduling_truth_engine.sql`;
   `scripts/migrate.ts` applies all files sorted by name and tracks them in `schema_migrations`).
6. **One process, one port.** Routes register at module scope before `startServer()`; never add
   proxy config, second ports, or an API base URL.
7. **All tenant-scoped DB access goes through the shared `runTenantQuery`** (extracted in Task 1).
   Webhook DB access included. Raw `pool.query` remains only for: cross-tenant org resolution by
   Twilio number, `requireAuth`, and the unauthenticated auth routes.
8. **Don't touch:** `src/mockData.ts` (ships a hardcoded `sk-…` key — out of scope, do not copy it),
   README credentials, `.neon`/`neon.ts`/`hello.ts` scaffold, `dist/`.
9. **Webhooks stay below the global `express.json()` parser** and keep their scoped
   `twilioFormParser`; routes under `/webhooks/*` are never covered by the new origin guard (Task 10).
10. **Environment:** commands must run from the repo root; use `npx tsx scripts/migrate.ts` to apply
    migrations; never run plain `npm install` (use `--legacy-peer-deps`); no new npm scripts.

## Task list (execution order = dependency order)

| # | Brief | Sprint item | Goal | Depends on |
|---|-------|-------------|------|------------|
| 1 | `task-01-tenant-context.md` | 2.5 | Extract `runTenantQuery` into `packages/application/tenant-context.ts` + tests | — |
| 2 | `task-02-twilio-fallback.md` | 3.1 | Remove unknown-Twilio-number fallback (DB + in-memory + voice + voice-status) | — |
| 3 | `task-03-ai-pipeline.md` | 2.3 (part 1) | Extract AI pipeline (`runSmsAssistant` + provider helpers + consts) into `packages/application/ai-pipeline.ts` | — |
| 4 | `task-04-conversation-service.md` | 2.3 (part 2) + 3.2-SMS | Extract SMS webhook business flow into `packages/application/conversation-service.ts`, run it inside one tenant txn | 1, 3 |
| 5 | `task-05-messagesid-idempotency.md` | 3.3 (MessageSid) | Add MessageSid dedupe in the SMS webhook + both unique partial indexes (initDb + migration 20260929000000) | 4 |
| 6 | `task-06-callsid-idempotency.md` | 3.3 (CallSid) | Add CallSid dedupe + `twilio_call_sid` write in the voice-status webhook | 2, 5 |
| 7 | `task-07-voice-status-tenant.md` | 3.2 (voice-status) | Wrap voice-status DB block in `runTenantQuery` | 1, 6 |
| 8 | `task-08-authorization.md` | 6.2 | Role matrix (owner/admin/dispatcher/technician/viewer) + `requirePermission` middleware + route annotations | — |
| 9 | `task-09-localstorage-jwt.md` | 6.1 | Remove the localStorage JWT mirror from the SPA (cookie-only) | — |
| 10 | `task-10-csrf-origin.md` | 6.3 | Origin/Referer guard for state-changing `/api/*` routes + `ALLOWED_ORIGINS` env | — |

Rationale for the order:

- Task 4 (conversation service) already runs the entire SMS webhook flow inside one
  `runTenantQuery` transaction — that IS the 3.2 "SMS webhook" half (lines 2614-2651), so Tasks 4
  and 7 together close Sprint item 3.2. Task 7 handles only the voice-status half.
- Task 5's migration file carries both unique idempotency indexes, so Task 6 (CallSid behavior)
  depends on Task 5 for the `missed_calls` index being present in `initDb()`/migrations; Task 2 must
  precede Task 6 so the org-resolution fallbacks are already gone from the same handler.
- Task 8/9/10 touch the API surface and the auth flow but are file-disjoint from 1-7; they are
  placed last so webhook work reviews first.

Each task brief pins exact paths, exact signatures/SQL/strings, tests to add, and the exact
verification commands. No judgment calls are left to the implementer.