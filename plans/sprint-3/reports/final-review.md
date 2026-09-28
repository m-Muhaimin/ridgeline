# Final whole-branch review — Sprint 3 (inline, controller-level)

Reviewer subagent could not spawn (free-tier agent restriction, same as task-reviewer all session);
the final gate was run inline by the controller with full cross-task context.

## Verdict: MERGE-WITH-FOLLOWUPS

No blocking findings. tsc clean, 159/159 tests pass (node:test, 12 suites), all 10 tasks gated individually.

## Confirmed pass

- Private gate of every task (01–10) against its brief: modules verbatim, deviations sanctioned + reported.
- Webhook flow end-to-end (server.ts ~2178-2500): SMS webhook → runTenantQuery + processInboundSms
  (SAVEPOINT scheduling, persist-error policy, MessageSid dedupe first-statement); voice webhook unknown-org
  reject; voice-status: CallSid pre-send guard -> outbound textback -> tenant txn (in-txn re-check +
  missed_calls/thread/sms_messages persists).
- Auth stack: requirePermission mounted immediately after requireAuth, before rate limiters, no DB.
  All 15 state-changing /api write routes accounted: 13 annotated, 3 /api/auth/* + 1 complete-onboarding
  exempt per brief. Grep: zero `ridgeline_session_token|ridgeline_user_email|Authorization|localStorage`
  in src/. Origin guard at server.ts:175-212 verbatim from brief, textually before first /api route.
- Schema triple-sync: twilio_message_sid + twilio_call_sid unique indexes in initDb() AND
  20260929000000_webhook_idempotency.sql; users.role DEFAULT 'owner' in initDb, migration, migrate-auth.
- Final suite rerun at controller level: tsc exit 0; 159/159 pass.

## Findings (all non-blocking)

| Sev | Location | Description |
|---|---|---|
| Low | conversation-service.ts customer INSERT | 23505 race branch unreachable on real PG: no SAVEPOINT, txn aborts, re-read throws 25P02. Outcome safe (rollback + Twilio retry + pre-check replay converge). Fix: SAVEPOINT around customer INSERT. |
| Low | .env.example:28 | Dead FORWARD_CALLS_TO line (Task 2 deleted the const). Remove. |
| Info | voice-status | Controller ruling: dual dedupe paths kept deliberately (pre-send guard gates irreversible textback; in-txn re-check closes persist race). Same predicate, unique index backstop. Consolidate later. |
| Info | roles matrix | No role-assignment UI; unknown/legacy role rows now deny all writes. DEFAULT 'owner' covers all seeds; no client code branches on the widened union (grep confirmed). |
| Info | task-08 report | Brief's requirePermission count (15) was wrong; 1 def + 13 usages = 14 correct. |

## Not introduced (checked)

No new unauthenticated routes; /api/neon/execute-sql + /api/ai/test-endpoint unchanged (dev affordances);
no API base URL; no new secrets; webhooks outside origin guard; staged WIP (policy-engine, server.ts
persist block) untouched throughout.

## State notes

- Nothing committed this session (repo convention; user restricted git commands). Branch state = staged +
  worktree edits. Ready for commit + IMPLEMENTATION.md sync (done).
- Two follow-ups tracked in todo list: FORWARD_CALLS_TO removal, SAVEPOINT hardening.
