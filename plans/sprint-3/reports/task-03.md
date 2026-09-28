# Task 3 — Extract the AI pipeline (report)

**Status:** complete. `npx tsc --noEmit` exits 0; `npm test` is 138 pass / 0 fail (baseline was
118 pass / 0 fail, so +20 new tests and no regressions). Nothing committed.

---

## 1. Files changed

| File | Change |
|---|---|
| `packages/application/ai-pipeline.ts` | **Created** — 340 lines. The moved pipeline. |
| `packages/application/__tests__/ai-pipeline.test.ts` | **Created** — 553 lines, 20 hermetic tests. |
| `server.ts` | **Edited** — 3310 → 2974 lines (net −336). Deleted the moved blocks, added the import, narrowed two imports, updated two call sites. |

Untouched, as required: the staged webhook persist block (`server.ts:2360-2440`, including the
"That visit is already under way" reply — verified still present and never in a diff), and
`packages/domain/conversations/policy-engine.ts` + its test. Also untouched: Task 1's
`packages/application/tenant-context.ts` + test, Task 2's `packages/domain/organizations/twilio-phone.ts` + test.

### `server.ts` edits in full

1. Line 5: `import { GoogleGenAI, Type } from '@google/genai';` → `import { GoogleGenAI } from '@google/genai';`
   (`Type` was used only by the moved response schema; `GoogleGenAI` is still needed to build `ai` at :178-181.)
2. Line 27: **removed** `import { detectEmergency } from './packages/domain/safety/triage.js';`
   — its only use in `server.ts` was line 2454, inside the moved function. `src/App.tsx:44` imports it
   directly from the package and is unaffected.
3. Line 42+: **added** the module import (the brief's import, formatted one-per-line by the repo's style):
   ```ts
   import {
     DEFAULT_OPENAI_API_KEY,
     DEFAULT_OPENAI_BASE_URL,
     DEFAULT_OPENAI_MODEL,
     RIDGELINE_SYSTEM_PROMPT,
     callOpenAiCompatibleChat,
     runSmsAssistant,
   } from './packages/application/ai-pipeline.js';
   ```
4. Deleted lines 204-312 (system prompt, the three `DEFAULT_OPENAI_*` constants, `callOpenAiCompatibleChat`)
   and lines 2280-2505 (`RunSmsAssistantOptions`, `SmsAssistantResult`, `runSmsAssistant`). Both deletions
   were line-range splices with a guard that asserted the first and the following line of each region
   before writing, so a drifted line number would have thrown rather than silently cutting wrong lines.
5. Two call sites gained the second argument — see §4.

The four `DEFAULT_OPENAI_*` / `RIDGELINE_SYSTEM_PROMPT` / `callOpenAiCompatibleChat` consumers
(`/api/neon/data` :1245-1247, `getOrgContext` :2137-2139, `/api/missed-call/process` :2691-2695,
`/api/health` :2754-2756) needed **no code change** — they now resolve through the import, as the
brief predicted. `callOpenAiCompatibleChat`'s signature is unchanged, so the missed-call Gemini branch
at :2708 still calls `ai.models.generateContent` directly with no edit.

## 2. Exported surface of `packages/application/ai-pipeline.ts`

```ts
import { GoogleGenAI, Type } from '@google/genai';
import { detectEmergency } from '../domain/safety/triage.js';

export const RIDGELINE_SYSTEM_PROMPT: string;
export const DEFAULT_OPENAI_BASE_URL: string;
export const DEFAULT_OPENAI_API_KEY: string;
export const DEFAULT_OPENAI_MODEL: string;

export async function callOpenAiCompatibleChat(options: {
  baseUrl?: string; apiKey?: string; model?: string;
  systemPrompt: string; userPrompt: string; jsonMode?: boolean;
}): Promise<string>;

export interface RunSmsAssistantOptions {
  incomingText: string;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  conversationHistory?: Array<{ sender: string; text: string }>;
  existingBookings?: any[];
  services?: any[];
  settings?: any;
}

export interface SmsAssistantResult {
  source: string; replyText: string;
  intent: 'book' | 'reschedule' | 'cancel' | 'inquiry' | 'emergency' | 'confirm';
  urgency: 'routine' | 'urgent' | 'emergency';
  actionTag: 'auto_booked' | 'rescheduled' | 'quote_given' | 'emergency_escalated' | 'slot_offered' | 'info_requested';
  serviceTitle: string | null;
  requestedSlot: string | null;   // verbatim customer time, or null
  extractedAddress: string | null;
  estimatedPrice: number;
  shouldConfirmBooking: boolean;
  model?: string;
}

export async function runSmsAssistant(
  options: RunSmsAssistantOptions,
  deps: { gemini: GoogleGenAI | null },
): Promise<SmsAssistantResult>;
```

No helper functions moved: `sanitizeForLog` and `logsForInference` do not exist in this tree, and the
only symbols between the two moved regions were unrelated (auth, PBKDF2, rate limiting, tenant/RLS,
Twilio org lookup, `getOrgContext`). `stripDayQualifier` stayed in `server.ts` as instructed.

## 3. The move is provably byte-identical

A normalization diff (old `server.ts` regions vs. the new module, comparing text after stripping the
new `export ` markers and trailing whitespace) reports:

```
A  prompt/constants/callOpenAiCompatibleChat identical: true
B  RunSmsAssistantOptions + SmsAssistantResult identical: true
C  runSmsAssistant body identical modulo signature + ai->deps.gemini: true
```

Region C is identical after exactly three substitutions, all mandated by the brief:

| Old | New |
|---|---|
| `export async function runSmsAssistant(options: RunSmsAssistantOptions): Promise<SmsAssistantResult> {` | 4-line signature adding `deps: { gemini: GoogleGenAI \| null }` |
| `if (!parsedResult && ai) {` | `if (!parsedResult && deps.gemini) {` |
| `await ai.models.generateContent({` | `await deps.gemini.models.generateContent({` |

The fence-stripping / `JSON.parse` logic is character-for-character unchanged
(`.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()` then `JSON.parse`), and it is now covered
by tests for the first time. No return value, provider order, provider-selection expression, or
fallback reply string changed.

## 4. Call-site transformation

Both sites changed shape identically — options object untouched, `{ gemini: ai }` appended:

```ts
// server.ts:2203 — POST /api/sms/process
const result = await runSmsAssistant({
  incomingText, customerName, customerPhone, address,
  conversationHistory, existingBookings, services,
  settings: safeSettings,
}, { gemini: ai });

// server.ts:2322 — POST /webhooks/twilio/sms
const assistantResult = await runSmsAssistant({
  incomingText: body, customerName, customerPhone: from, address: customerAddress,
  conversationHistory: history, existingBookings: bookings, services,
  settings: { ...settings, businessName: org.name, tradespersonName: ..., tradeType: ... },
}, { gemini: ai });
```

Per the brief's note, the webhook call site was updated now rather than deferred to Task 4, because
the one-argument form does not compile.

## 5. Tests — 20 cases, all hermetic

No server, no database, no network, no LLM. The Gemini tier is skipped with `deps: { gemini: null }`
and the OpenAI tier is either skipped with `settings.llmProvider: 'gemini'` or intercepted by swapping
`globalThis.fetch` for a recorder (restored in a `finally`). `node:test` + `node:assert/strict`.

**The brief's five cases** (fallback tier, `llmProvider: 'gemini'` + `gemini: null`):
1. *Emergency* — `'water flooding in kitchen'` → `intent: 'emergency'`, `urgency: 'emergency'`,
   `actionTag: 'emergency_escalated'`, `estimatedPrice: 380`, and a reply leading with the water
   triage instruction. As the brief predicted, the reply does **not** contain the literal word
   "URGENT" — actual wording is `"Shut off the main water valve clockwise… T will get on this as
   fast as possible - what is your street address?"`, asserted directly and noted in a comment.
2. *Relative-date booking request* — `Book me ${tomorrow} at 10am for a faucet install`, tomorrow
   built from local calendar parts (not `toISOString()`, so no TZ skew) → `source: 'fallback'`,
   `shouldConfirmBooking: false`, and `requestedSlot === null`. See deviation D2.
3. *Quote inquiry* — `'how much for a faucet install?'` → `actionTag: 'quote_given'`, `urgency:
   'routine'`, reply contains `$195-$285`, `requestedSlot: null`.
4. *Greeting* — `'hi'` → `info_requested`, asks for issue + address, books nothing.
5. *Never throws* — `assert.doesNotReject` on empty input. See deviation D3.

**Provider selection (5).** `llmProvider: 'gemini'` skips the OpenAI tier entirely (asserted via a
fetch recorder that records zero calls, even with an `openaiApiKey` present); a configured
`openaiApiKey` selects the OpenAI tier and returns `source: 'openai_compatible'` with
`model: 'test/model-1'`; the exact request shape is asserted (URL join with trailing-slash strip,
`POST`, `Authorization: Bearer …`, `Content-Type`, `model`, `temperature: 0.2`,
`response_format: { type: 'json_object' }`, system message === `RIDGELINE_SYSTEM_PROMPT`, and the user
message carrying the customer text, the service catalog, the conversation history and
`Today's Date: <today>` computed identically to the pipeline's own expression so it cannot drift).

**Fence stripping (4).** A ` ```json ` fenced reply parses to the model's `replyText` with the fences
gone; a bare ` ``` ` fence with surrounding whitespace likewise; a fence wrapped in prose
(`"Sure! Here is the JSON:\n```json…```"`) degrades to `source: 'fallback'` rather than throwing —
current behavior, explicitly locked in with a comment; a malformed reply and a non-2xx response both
degrade to the rule engine instead of throwing.

**Gemini tier (4).** The injected client receives `model: 'gemini-3.8-flash'`, the prompt as `contents`,
and a config with `systemInstruction === RIDGELINE_SYSTEM_PROMPT` + `responseMimeType:
'application/json'`; `source === 'gemini'`. `gemini: null` skips the tier; a throwing client and a
non-JSON `text` both degrade to the rule engine.

**`callOpenAiCompatibleChat` directly (2).** An empty API key rejects with
`/OpenAI-compatible API key is not configured/` — asserted *without* a fetch stub, so a regression that
spends the doomed round-trip fails the test loudly; and an SSE `data:` stream is accumulated
(`'On my '` + `'way.'`).

## 6. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npm test` | **exit 0** — 138 tests, 12 suites, 138 pass, 0 fail (was 118 before; +20) |
| `grep -n "runSmsAssistant" server.ts` | 3 hits: `:48` (import), `:2203` (`/api/sms/process`), `:2322` (webhook). No declaration. |
| `grep -n "RIDGELINE_SYSTEM_PROMPT\|DEFAULT_OPENAI" server.ts` | Only the import block (`:43-45`) and call sites (`:1245-1247`, `:2137-2139`, `:2681`, `:2692-2694`, `:2754-2756`). No `const` declaration remains. |
| `grep -nE "^(export )?(const\|function\|interface\|async function) (RIDGELINE_SYSTEM_PROMPT\|DEFAULT_OPENAI\|callOpenAiCompatibleChat\|runSmsAssistant\|SmsAssistantResult\|RunSmsAssistantOptions)" server.ts` | no matches |
| Runtime boot (`PORT=3999 npx tsx server.ts`) | `RidgeLine server running on http://0.0.0.0:3999` — the new import graph resolves at boot |
| Staged webhook block | `git diff -- server.ts` contains no deletion matching `already under way\|SAVEPOINT\|sms_messages\|BEGIN;\|COMMIT;\|sms_thread_id\|cancelThreadBookings\|rescheduleThreadBookings`; the reply string is still present at `server.ts` |

## 7. Deviations from the brief

Three, all in the **test** file, all forced by the current implementation. No production code and no
API surface deviates from the brief.

**D1 — the assertion contract in the brief describes a shape that does not exist.** The brief says to
assert `emergencyDetected` boolean and `requestedSlot` object-or-null. `SmsAssistantResult` has
**neither**: there is no `emergencyDetected` field at all, and `requestedSlot` is `string | null`
("a time the CUSTOMER asked for, verbatim"). Asserting them would have required inventing behavior.
Instead, a shared `assertResultShape()` helper asserts the *actual* contract — `source` non-empty
string, `replyText` non-empty string, `intent`/`urgency`/`actionTag` within their unions,
`requestedSlot` string-or-null, `serviceTitle`/`extractedAddress` string-or-null, `estimatedPrice`
number, `shouldConfirmBooking` boolean — and a comment in the file records the correction. Every
emergency assertion uses the real signals (`intent`/`urgency`/`actionTag`), which is a *stronger*
check than the boolean the brief imagined.

**D2 — brief test 2 could not pass as written.** It expects the rule-based tier to return
`requestedSlot !== null` with a `.start`. The fallback assigns `let requestedSlot: string | null = null;`
once and **never reassigns it**, with the reason spelled out in the code it moved from: *"The rule
engine classifies intent only. It has no reliable way to tell whether a customer named a time, and a
guessed one gets written straight into the schedule, so it defers to the scheduling engine."* Slot
extraction is `resolveRequestedSlot` in `booking-service.ts`. So the test asserts the real, safe
behavior — `requestedSlot === null`, `shouldConfirmBooking === false`, and the computed date absent
from the reply — and a comment explains that asserting a non-null slot here would lock in the unsafe
behavior. The brief's "relative date, no drift" intent is preserved two ways: the date is built from
local calendar parts so the test cannot drift across a timezone, and the *model* path
(`requestedSlot` passthrough from a parsed reply) is asserted separately in the OpenAI-compatible
tests.

**D3 — brief test 5 needed `llmProvider: 'gemini'`.** Its `settings` object omits `llmProvider`, so
`preferredProvider` falls to `settings.openaiApiKey || DEFAULT_OPENAI_API_KEY` — and
`DEFAULT_OPENAI_API_KEY` reads `process.env.OPENAI_COMPATIBLE_API_KEY`, which is populated by
`.env.local` on this machine. A "hermetic, no network" test that reaches a real gateway on a
developer who has a key configured is not hermetic, so the one field the brief's own preamble says to
"always" pass was added. Documented in a comment at the call site.

Two smaller notes, no deviation from the brief's letter:

- **No `fetchImpl` dep was added.** The brief fixes `deps` to `{ gemini: GoogleGenAI | null }`, so
  the OpenAI-tier tests stub `globalThis.fetch` (restored in a `finally`) instead of widening the
  signature. This keeps the deps shape the brief specified and still gives a full assertion of the
  outgoing request. If Task 4 wants a fetch seam instead, that is a one-line signature change here.
- `assertResultShape` allows `serviceTitle`/`extractedAddress` to be `null`, matching the interface.
  The fallback always returns strings (`extractedAddress: address || ''`); only a model reply can
  return `null` for either, and the interface permits it.

## 8. For Sentinel / Probe

- **Sentinel:** the security posture is unchanged, but note the LLM provider/base-URL/API-key
  injection surface is now in a different file. `stripServerOnlyAssistantKeys` stays in `server.ts`
  and is still applied at both `/api/sms/process` (:2201) and `/api/missed-call/process`, so the
  SSRF primitive is still closed at the route boundary — but the pipeline itself will happily call
  whatever `settings.openaiBaseUrl` it is handed. Anyone adding a third consumer of
  `runSmsAssistant` must sanitize first. Also still live in the moved file:
  `DEFAULT_OPENAI_BASE_URL` retains the hardcoded `9router-production-a99a.up.railway.app` default and
  `DEFAULT_OPENAI_API_KEY` is `process.env.OPENAI_COMPATIBLE_API_KEY || ''` (empty string, not
  undefined — intentional, so the provider chain degrades instead of attempting a keyless request).
- **Probe:** `/api/sms/process` and `/webhooks/twilio/sms` should be exercised with `GEMINI_API_KEY`
  set and unset, and with `OPENAI_COMPATIBLE_API_KEY` set and unset, across all three
  `llmProvider` values. The moved `console.warn` strings
  (`'OpenAI-compatible call failed, falling back:'`, `'Gemini call failed, falling back to rule-based
  engine:'`) are now the primary signal that a tier is silently degrading — a request that "succeeds"
  with a generic-sounding reply and one of those warnings is the case to catch.
- **Task 4** can import `{ runSmsAssistant, callOpenAiCompatibleChat, type SmsAssistantResult }` from
  `./ai-pipeline.js` with no further extraction.
