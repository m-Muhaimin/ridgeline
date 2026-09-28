# Task 3 — Extract the AI pipeline (Sprint 2, item 2.3, part 1)

## Goal
Move the SM S assistant AI machinery out of `server.ts` into `packages/application/ai-pipeline.ts`:
the system prompt, provider constants, `callOpenAiCompatibleChat`, `runSmsAssistant`, its result
interface, and every helper used only by them. `server.ts` keeps creating the Gemini client
(`ai`, ~164-176) and passes it in as a dependency. Pure move — no behavior change.

## Files
- **Create** `packages/application/ai-pipeline.ts`
- **Create** `packages/application/__tests__/ai-pipeline.test.ts`
- **Edit** `server.ts` — delete the moved blocks, add the import, update caller sites.

## Design decisions (already made)
- `runSmsAssistant(options, deps)` — the Gemini client moves out of module scope into `deps.gemini`.
- Provider constants stay exported from `ai-pipeline.ts` because `server.ts` still references them
  at 4 call sites (see below). Nothing else does.
- `ai` remains `let ai: GoogleGenAI | null` in `server.ts`, created exactly as today. After this
  task, `server.ts` imports only `{ GoogleGenAI }` from `'@google/genai'` (the `Type` import moves
  with the prompt schema).
- The OpenAI fallback-to-heroku behavior inside `runSmsAssistant`/`callOpenAiCompatibleChat` moves
  unchanged.

## What moves, exactly (locate by symbol and by the current line numbers)
| Symbol / region | Current line(s) | Destination |
|---|---|---|
| `RIDGELINE_SYSTEM_PROMPT` | ~192 | `ai-pipeline.ts` (export const, same value) |
| `DEFAULT_OPENAI_BASE_URL`, `DEFAULT_OPENAI_API_KEY`, `DEFAULT_OPENAI_MODEL` | ~212-218 | `ai-pipeline.ts` (export const, same values) |
| `callOpenAiCompatibleChat` | ~221 to its closing brace | `ai-pipeline.ts` |
| `SmsAssistantResult` interface | ~2318 | `ai-pipeline.ts` (export) |
| `runSmsAssistant` | ~2338 to its closing brace | `ai-pipeline.ts` — change signature to `runSmsAssistant(options, deps: { gemini: GoogleGenAI | null })`; every `ai` reference in its body becomes `deps.gemini` |
| Any helper function defined **between** those regions that is used only by them (check each with repo-wide grep: candidates `sanitizeForLog`, `logsForInference`, prompt-builder functions) | — | `ai-pipeline.ts`, unexported unless referenced outside |

Rules of the move:
- A helper stays in `server.ts` if anything **outside** the moved region references it; in that case
  keep it exported-compatible by leaving it where it is (do not export it from ai-pipeline).
- Do not move `stripDayQualifier` (used by the webhook in-memory branch, stays in server.ts),
  `detectEmergency` re-export, or the Gemini client creation.
- `ai-pipeline.ts` imports: `import { GoogleGenAI, Type } from '@google/genai';` and
  `import { detectEmergency } from '../domain/safety/triage.js';` plus whatever moved helpers need.

## `server.ts` edits
1. Add import:
   `import { DEFAULT_OPENAI_API_KEY, DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL, RIDGELINE_SYSTEM_PROMPT, callOpenAiCompatibleChat, runSmsAssistant } from './packages/application/ai-pipeline.js';`
2. Delete the moved regions. Change `import { GoogleGenAI, Type } from '@google/genai';` →
   `import { GoogleGenAI } from '@google/genai';`
3. Caller updates:
   - `/api/sms/process` (~2565): `runSmsAssistant({ ... })` → `runSmsAssistant({ ... }, { gemini: ai })`
   - `/api/neon/data` (~1373-1375): `DEFAULT_OPENAI_*` usages now resolve via import (no code change needed beyond the import)
   - `getOrgContext` (~2272-2275): same — consts resolve via import; getOrgContext itself is NOT moved in this task
   - `/api/missed-call/process` (~3030-3045): `RIDGELINE_SYSTEM_PROMPT` / `DEFAULT_OPENAI_*` / `callOpenAiCompatibleChat` resolve via import; the `ai`-based Gemini branch (`~3057`) gets `ai !== null` checked as today and passes `ai` directly to `callOpenAiCompatibleChat(...)` if it does today — no signature change on that function
   - `/api/health` (~3103-3105): consts via import
   - The SMS webhook's `runSmsAssistant` call (~2684) — update in Task 4 (leave as-is now, it compiles only if you also give it `{ gemini: ai }`; **do update it now** to keep the build green).

## Tests — `packages/application/__tests__/ai-pipeline.test.ts`
Deterministic, no network, no LLM. Always pass `settings.llmProvider: 'gemini'` (so the OpenAI branch
is skipped) and `deps: { gemini: null }` (so the Gemini branch is skipped) → guaranteed rule-based
fallback. Use `node:test` + `node:assert/strict`.

State the assertion contract from the current fallback implementation: `source: 'fallback'`,
`replyText` non-empty string, `emergencyDetected` boolean, `requestedSlot` object-or-null.

1. **Emergency:** body `'water flooding in kitchen'`, empty services → `emergencyDetected === true`,
   `source === 'fallback'`, `replyText` includes `'URGENT'` (check the current fallback's emergency
   reply text; if it does not literally contain URGENT, assert `replyText.length > 0` instead and
   note the actual wording in a comment).
2. **Slot parse (relative date, no drift):** compute `const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);` build `YYYY-MM-DD`; body `\`Book me ${tomorrow} at 10am for a faucet install\`` with `services: [{ id: 's1', name: 'faucet install', durationMinutes: 60 }]` → `source === 'fallback'`, `requestedSlot !== null`, `requestedSlot.start` matches the expected local start (assert on ISO string prefix contains the computed date).
3. **Quote inquiry:** body `'how much for a faucet install?'`, same services → `requestedSlot === null`, `emergencyDetected === false`, `replyText` non-empty.
4. **Greeting:** body `'hi'` → `requestedSlot === null`, `emergencyDetected === false`, `source === 'fallback'`.
5. **Never throws:** `await assert.doesNotReject(runSmsAssistant({ incomingText: '', customerName: 'C', customerPhone: '+15551234567', address: '', conversationHistory: [], existingBookings: [], services: [], settings: { businessName: 'B', tradespersonName: 'T', tradeType: 'plumbing' } }, { gemini: null }))`.

## Verification
```bash
npx tsc --noEmit
npm test
```
`grep -n "runSmsAssistant" server.ts` → exactly 2 call sites (sms/process, webhook), plus the import.

## Where it fits
Task 3 is the move half of 2.3; Task 4 consumes `runSmsAssistant` + `callOpenAiCompatibleChat` from
`ai-pipeline.ts` inside the conversation service.