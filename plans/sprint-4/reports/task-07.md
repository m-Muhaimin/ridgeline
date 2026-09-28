# Task 7 — Missed calls page (`/missed-calls`) — Report

**Status:** complete. All three static gates green. No server booted (wave rule).

---

## Files (exactly the three owned — nothing else touched)

| File | Action | Size |
|---|---|---|
| `apps/web/components/MissedCallsView.tsx` | Create (copy) | 355 lines / 16505 bytes |
| `apps/web/components/SimulateCallModal.tsx` | Create (copy) | 186 lines / 8030 bytes |
| `apps/web/app/(dashboard)/missed-calls/page.tsx` | Create (port) | 42 lines |

Nothing else was created, edited, moved or deleted. Verified with `git status --porcelain`
(see Deviations): the only new paths are the three above, inside the already-untracked
`apps/` and `plans/sprint-4/` trees.

---

## Byte-identical copies — confirmed

`cp` (not a re-type), so no editor normalization could creep in. Confirmed three ways:

```
$ diff src/components/MissedCallsView.tsx apps/web/components/MissedCallsView.tsx
IDENTICAL          # empty diff, exit=0

$ diff src/components/SimulateCallModal.tsx apps/web/components/SimulateCallModal.tsx
IDENTICAL          # empty diff, exit=0

$ sha256sum ...
d1cd6154a9e1158a3a1c5ca6c74dc7493a54d1b6c5beed215d6adb66f0fbc749 *src/components/MissedCallsView.tsx
d1cd6154a9e1158a3a1c5ca6c74dc7493a54d1b6c5beed215d6adb66f0fbc749 *apps/web/components/MissedCallsView.tsx
36065a8b0a4d2fcc2da1397dda75e4e8e6cdd38da550e8f560587972a75cf7b7 *src/components/SimulateCallModal.tsx
36065a8b0a4d2fcc2da1397dda75e4e8e6cdd38da550e8f560587972a75cf7b7 *apps/web/components/SimulateCallModal.tsx

  355 16505 src/components/MissedCallsView.tsx
  355 16505 apps/web/components/MissedCallsView.tsx
  186  8030 src/components/SimulateCallModal.tsx
  186  8030 apps/web/components/SimulateCallModal.tsx
```

Line/byte counts match the brief's stated 355 / 186 exactly.

**Page file also verified verbatim against the brief** — extracted the brief's fenced
block (`task-07-missed-calls.md:29-70`) and diffed it against the file I wrote:

```
$ diff /tmp/brief-page.tsx "apps/web/app/(dashboard)/missed-calls/page.tsx"
PAGE MATCHES BRIEF VERBATIM   # empty diff, exit=0
  42 /tmp/brief-page.tsx
  42 apps/web/app/(dashboard)/missed-calls/page.tsx
```

No comment header, no doc block, no reformatting was added to the page — the brief's code
block *is* the whole file.

### Imports inside the verbatim copies resolve against apps/web
- `../types` → `apps/web/types.ts` (`MissedCall`, `JobBooking`, `TradeType` all exported;
  `MissedCall` has `callerName/callerPhone/timestamp/durationSeconds/voicemailTranscript?
  /autoSmsSent/autoSmsTimestamp?/autoSmsReplyReceived/convertedToBooking/bookingId?/
  urgency/createdAt?` — every field the view reads).
- `../lib/chartUtils` → `apps/web/lib/chartUtils.ts` (task 2). `calculateSevenDaysMetrics`
  is the only symbol used.
- `./EmptyState`, `./AIIcon` → task 3's copies.
- `./ChartSkeleton` → **task 4's** `apps/web/components/ChartSkeleton.tsx` (no second copy
  created). `TabChartSkeletonProps` (`title, subtitle, badgeText, heightClass, accentColor,
  type, legendLabels`) covers all seven props the two skeleton branches pass.

---

## The simulate wiring, as written

Page: `apps/web/app/(dashboard)/missed-calls/page.tsx`, per brief.

**Endpoint contract** (re-verified against `server.ts:2549-2628`, not just the brief):
`POST /api/missed-call/process`, middleware chain `requireAuth` →
`requirePermission('assistant.run')` → `rateLimitPerOrg({ scope: 'missed-call-process' })`.
- Request body read: `{ callerName, callerPhone, voicemailTranscript, settings: rawSettings = {} }`.
- `settings` is run through `stripServerOnlyAssistantKeys(rawSettings)` server-side, so
  passing the provider's `settings` object straight through is safe — client-supplied
  LLM provider / base URL / API key are dropped before the pipeline runs.
- Response: `res.json({ autoSms })` (or `500 { error }`). The handler also `INSERT`s a
  `public.missed_calls` row when `pool` is available.
- **No `urgency` field is read by the endpoint.** The handler keeps `urgency` in its
  signature (so the modal's 4-arg prop contract is unchanged) and omits it from the
  `JSON.stringify` body — exactly as the brief decided.

**Order of operations:** POST → `await syncFromNeon(true)` → toast. The re-sync is
required, not cosmetic: the row is written server-side, so the page cannot patch local
state. `syncFromNeon` is awaited before the toast so the toast never precedes the data.

**Error path:** `catch (err: any) { showToast(err?.message || 'Missed call simulation failed.') }`.
`apiFetch` (task 2) throws `Error`s carrying `HTTP <status> …` plus a 200-char body
snippet, so a 401/403/429 from the middleware chain surfaces as readable toast text
rather than a silent failure. Note the modal's own `handleTrigger` also closes on success
(`setIsSimulating(false); onClose();`) — a rejected request surfaces only as the toast,
which is the brief's pinned behavior.

**Provider contract used:** `missedCalls`, `bookings`, `isDataLoading`,
`openThreadForPhone`, `settings`, `showToast`, `syncFromNeon` — all read off the frozen
task-3 `useData()`. No provider edit, no new handler, no prop added.

**The one-off `apiFetch` call:** this is the only `apiFetch` in any page file in the
sprint. Everything else on the page is prop drilling from `useData()`.

**Shell already wired (task 3, not mine to touch):** `AppSidebar.tsx:156-157` marks
`/missed-calls` active and pushes to it; `AppSidebar.tsx:162-165` renders the pending
badge from `unconvertedCallsCount`; `Header.tsx:51-52` returns
`"Missed Call Recovery Pipeline"` for that path. The route now exists, so all three
resolve at runtime.

---

## Gate outputs (verbatim)

Run from repo root, cwd = repo root. No server was booted.

### Gate 1 — root typecheck
```
$ npx tsc --noEmit
ROOT TSC EXIT=0
```
No output at all, exit 0. Confirmed the root gate really does cover this task's files
(root `tsconfig.json` has no `include`/`files`, so it sweeps everything):
```
$ npx tsc --noEmit --listFiles | grep -c "remix-ridgeline/apps/web"
563
…/apps/web/components/ChartSkeleton.tsx
…/apps/web/components/MissedCallsView.tsx
…/apps/web/components/SimulateCallModal.tsx
…/apps/web/app/(dashboard)/missed-calls/page.tsx
```

### Gate 2 — tests
```
$ npm test
…
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1996.7024
NPM TEST EXIT=0
```
159/159, unchanged from the stated baseline.

### Gate 3 — apps/web lint
```
$ npm --prefix apps/web run lint

> ridgeline-web@0.0.0 lint
> tsc --noEmit

WEB LINT EXIT=0
```

`apps/web` "lint" is `tsc --noEmit`, not ESLint, so the dead-import note below is not a
gate failure — just a fact worth recording.

---

## Deviations from the brief

**None.** Both copies are `cp` + verified-identical; the page matches the brief's code
block byte-for-byte. No deviation, no addition, no dead code of my own.

## Findings (for the controller / Sentinel / Probe)

1. **Stale comment in `server.ts:2545-2548`** — the endpoint's header comment still says
   *"No live client caller exists (the simulate-call modal is never mounted and issues no
   fetch)"*. This task makes exactly that false. I do not own `server.ts` (it is already
   modified in the working tree by sprint-3 work), so I left it. Someone should delete
   those four lines or the next reader inherits a lie.

2. **The toast overstates what happened.** The endpoint never sends an SMS — it LLM-drafts
   text, `INSERT`s a `missed_calls` row with a hardcoded `auto_sms_sent = true`, and
   returns `{ autoSms }`. I grepped the handler body for `twilioClient` / `messages.create`:
   no match. So `Auto-textback sent to ${callerName}: ${data.autoSms}` reports delivery of
   something that was only *written*. The copy is pinned by the brief, so I wrote it
   verbatim — but if a real deploy wires Twilio here, the string becomes true; today it is
   aspirational. Consider re-wording at review time.

3. **The AGENTS.md silent-fallback trap applies to this page.** With `DATABASE_URL` unset
   the endpoint still returns 200 with an `autoSms`, the toast still fires, and nothing
   persists — the table will not change after `syncFromNeon`. A Probe checking "the new
   call appears in the table" must confirm `GET /api/neon/status` reports connected first,
   or it will read a working feature as broken. Related: `syncFromNeon` only overwrites a
   collection when `data.missedCalls?.length > 0` (DataProvider.tsx:161), so a genuinely
   empty server-side list would also leave the mock seed on screen.

4. **Runtime gating for Probe.** The 200 in the brief's checklist needs a logged-in
   session *with the `assistant.run` permission* and within the
   `rateLimitPerOrg({ scope: 'missed-call-process' })` budget. `credentials: 'include'` is
   present on the call, so the cookie path works; failures come back as
   `Error: Request to … failed with HTTP 403 …` and land in the toast.

5. **Harmless dead import carried by the verbatim rule.**
   `SimulateCallModal.tsx:3` imports `TradeType` from `../types` and never uses it (true of
   the `src/` original too). Neither tsconfig sets `noUnusedLocals` and `apps/web lint` is
   `tsc --noEmit`, so it is not a gate failure. Kept because the brief says byte-identical.

6. **Loading behavior worth expecting in the sweep.** `syncFromNeon(true)` flips
   `isDataLoading` on and clears it after a `max(0, 500 - elapsed)` timer, so immediately
   after a successful simulate the page will render `MissedCallsView`'s `isLoading &&
   missedCalls.length === 0` skeleton branch (banner stub + `TabChartSkeleton`) for roughly
   half a second before the table returns. That is the existing provider timing, not
   something this page added — but it will look like a flash of skeleton in a video review.

7. **Probed-and-true, no action:** per-row "View SMS Thread" → `openThreadForPhone` →
   `threads.find(t => t.customerPhone === phone)` → `openThread` → `router.push('/sms')`.
   A caller with no matching thread is a silent no-op (no route change, no toast) — same
   as the `src/` behavior in `App.tsx:898-904`, so the port is faithful.
