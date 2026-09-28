# Task 3 — Dashboard shell + `useData()` context — Report

**Status:** ✅ complete. All gates green. Not committed (no commit was requested).

---

## 1. Files created (11 new, 0 pre-existing files modified outside `apps/web/`)

All under `apps/web/`. Nothing in the root repo was modified. The pre-existing
`M server.ts` and `M supabase/migrations/...` were already dirty before this task and were
not touched.

| New file | Source | Fidelity |
|---|---|---|
| `apps/web/components/DataProvider.tsx` (734 ln) | `src/App.tsx` state + handlers | ported per brief §DataProvider |
| `apps/web/components/DashboardShell.tsx` (154 ln) | `src/App.tsx:590-1029` | ported per brief §DashboardShell |
| `apps/web/components/AppSidebar.tsx` (404 ln) | `src/components/AppSidebar.tsx` | ported, 56 changed lines (props → context) |
| `apps/web/components/Header.tsx` (139 ln) | `src/components/Header.tsx` | ported, 41 changed lines (props → context) |
| `apps/web/app/(dashboard)/layout.tsx` (7 ln) | brief snippet | **byte-exact** to the brief |
| `apps/web/app/(dashboard)/page.tsx` (3 ln) | brief snippet | **byte-exact** to the brief |
| `apps/web/components/ui/sidebar.tsx` | `src/components/ui/sidebar.tsx` | **byte-identical** |
| `apps/web/components/ui/button.tsx` | `src/components/ui/button.tsx` | **byte-identical** |
| `apps/web/components/EmptyState.tsx` | `src/components/EmptyState.tsx` | **byte-identical** |
| `apps/web/components/OrgSwitcher.tsx` | `src/components/OrgSwitcher.tsx` | **byte-identical** |
| `apps/web/components/NewBookingModal.tsx` | `src/components/NewBookingModal.tsx` | verbatim **+ 1 fix** — *see deviation D1* |

Copy-fidelity proof:

```
IDENTICAL  src/components/ui/sidebar.tsx -> apps/web/components/ui/sidebar.tsx
IDENTICAL  src/components/ui/button.tsx  -> apps/web/components/ui/button.tsx
IDENTICAL  src/components/EmptyState.tsx -> apps/web/components/EmptyState.tsx
IDENTICAL  src/components/OrgSwitcher.tsx -> apps/web/components/OrgSwitcher.tsx
```

**Already present from task 2, not re-created:** `RidgeLineLogo.tsx`, `AIIcon.tsx`
(byte-identical to `src/`, verified in task 2), `lib/apiFetch.ts`, `lib/triage.ts`, `mockData.ts`,
`types.ts`.

**No `'use client'`** in any `apps/web/components/**` or `apps/web/lib/**` file. The only
client boundary is `app/(dashboard)/layout.tsx`. Verified by grep: the directive appears in
`layout.tsx`, `app/(auth)/auth/page.tsx`, `app/(auth)/onboarding/page.tsx`,
`app/health/page.tsx` (task 2 files) and **nowhere else**.

---

## 2. Deviations from the brief (both deliberate, both flagged)

### D1 — `NewBookingModal.tsx`: moved one line to fix a hard crash

The brief says copy this file verbatim. Verbatim copy **crashes the entire app** when either
booking entry point is used:

```
React has detected a change in the order of Hooks called by NewBookingModal.
   Previous render            Next render
12. undefined                 useEffect
```

`src/components/NewBookingModal.tsx:38` has `if (!isOpen) return null;` *above* its
`useEffect` (line 40). The component is always mounted (the shell renders it with
`isOpen={isNewBookingOpen}`), so on the first `false → true` transition the hook list grows
from 11 to 12. React unmounts the whole tree; the browser shows only
"This page couldn't load / Reload to try again".

**This bug is pre-existing and not introduced by the port.** Verified against the untouched
root Vite app on `:3000` — clicking its "Book" button empties `#root` the same way:

```
#root children = 0, #root innerHTML length = 0
```

The fix is a pure line move — the early return now sits *after* the effect:

```diff
-  if (!isOpen) return null;
-
   useEffect(() => {
     if (!isOpen || !date) return;
     ...
   }, [isOpen, date, selectedServiceId, services]);
+
+  if (!isOpen) return null;
```

That is the *only* delta from `src/components/NewBookingModal.tsx` (plus a 5-line explanatory
comment). Behaviour is unchanged: the effect already early-returns on `!isOpen`, so it still
never fetches while closed; only the hook *order* is now stable across the transition.

**Not fixed in `src/`** — out of scope for task 3 (root `src/` is being retired in favour of
`apps/web/`). Flagging for the controller: the root app's booking button is broken today, and
`src/components/NewBookingModal.tsx` should get the same one-line move if it is still shipped
anywhere.

### D2 — `DataProvider.tsx`: 8 `fetch()` calls converted to `apiFetch()`

Global constraint #2 requires every `apps/web` API call to go through `apiFetch` with relative
paths and `credentials: 'include'`. The port initially carried 8 raw `fetch()` calls across from
`App.tsx`. All 8 are now `apiFetch()` (relative path; `apiFetch` defaults
`credentials: 'include'`, so the explicit option was dropped as redundant):

| Handler | Endpoint |
|---|---|
| `handleLogout` | `POST /api/auth/logout` |
| `handleSelectOrg` | `POST /api/organizations/switch` |
| `handleSendMessage` | `POST /api/sms/message` |
| `handleSendEtaSms` | `PATCH /api/bookings/${id}` |
| `handleUpdateStatus` | `PATCH /api/bookings/${id}` |
| `handleUpdateSettings` | `PATCH /api/assistant-settings` |
| `handleDeleteService` | `DELETE /api/services/${id}` |
| (already compliant) | `handleAddBooking` → `POST /api/bookings` |

`apiFetch` throws on non-2xx, so the fire-and-forget handlers keep their existing
`.catch(console.warn)` shape — no new unhandled rejections. `handleLogout` and
`handleSelectOrg` already wrap in `try/catch`. Every one of these endpoints returns
`res.json(...)` on the success path (checked in `server.ts`: logout 881, services DELETE 2098,
bookings PATCH 1708, settings PATCH 1982), so no call can trip `apiFetch`'s non-JSON guard.

`grep` proof — the only remaining bare `fetch` mention in the file is a comment:

```
$ grep -n "[^i]fetch(" apps/web/components/DataProvider.tsx | grep -v apiFetch
582:    // fetch().catch(console.warn) would leave a rejected save
$ grep -c "apiFetch(" apps/web/components/DataProvider.tsx
17
```

### Not changed, and why

`apps/web/app/health/page.tsx:23` also uses a bare `fetch`, and that one is **intentional and
pre-existing from task 2** — its own comment says so: *"Bare fetch on purpose: lib/apiFetch is
task 2's deliverable. This page exists to prove a relative /api/* request survives the
:3001 → :3000 rewrite, so it must not depend on any app lib."* It is a diagnostic probe, not app
traffic, and it is not a task-3 file. Left untouched.

---

## 3. Contract compliance

`DataContextValue` matches the brief line-for-line, in order, with the brief's `//` source-line
annotations preserved as trailing comments. Verified member-by-member:

- All 30 state values and setters from the brief's state list, including `settingsSubTab` /
  `setSettingsSubTab` (plain `useState<SettingsSubTab>('general')` in the provider, per brief).
- All 19 handler members with the exact signatures given, including
  `handleSendMessage(threadId, text, sender, actionTag?, senderName?)`,
  `handleSendTestSms(text, customerName?, customerPhone?): Promise<string>`,
  `syncFromNeon(showLoading?: boolean): Promise<void>`.
- `selectThread` is set-state only; `openThread` = select + `router.push('/sms')`;
  `openThreadForPhone` = find-in-threads then `openThread` (brief's §note).
- `export const DataProvider: React.FC<{ children: React.ReactNode }>` and
  `export function useData(): DataContextValue` which **throws** outside a provider.
- `export type SettingsSubTab` is imported from `../types` (task 2's single definition) — not
  redeclared.

`AppSidebar` / `Header` were converted from prop-drilling to `useData()`, which is why they
differ from their `src/` originals. Every nav target, badge, and title mapping is preserved
verbatim.

One transcription bug caught and fixed during the port: the ETA handler's thread lookup was
written `t.smsThreadId`; the correct field is `t.id` (`App.tsx` uses `t.id`).

---

## 4. Gates

| Gate | Command | Result |
|---|---|---|
| Root typecheck | `npx tsc --noEmit` | **exit 0** |
| Root tests | `npm test` | **159 pass / 0 fail**, 12 suites, 1.73 s |
| Web typecheck | `npm --prefix apps/web run lint` | **exit 0** |
| Web build | `npm --prefix apps/web run build` | **✓ success**, 14.1 s compile / 4.9 s TS |

All four re-run **after** both code changes (D1, D2) — not just before them. Build route table
is correct for a task-3 shell: `/`, `/_not-found`, `/auth`, `/health`, `/onboarding`. The seven
dashboard sub-pages (dispatch, sms, missed-calls, customers, settings, …) are absent by design;
they are tasks 4–9. There is no `Suspense` bailout and no prerender of a client-only shell.

Build warnings are pre-existing and unrelated: Vite `configLoader: 'native'` notice, and the
multiple-lockfile notice (repo ships `bun.lock`; task 10 removes Vite entirely).

---

## 5. Runtime verification

Real backend (`server.ts` on `:3000`, live Neon Postgres `frosty-frog-53077141`, prod branch),
Next dev on `:3001`, Chrome via CDP on `:9222`. Session: demo user Mark Kowalski
(`mark@apexplumbingpro.com` / `Password123!`).

**Unauthenticated guard — no shell flash.** Raw SSR of `/` with no cookie:

```
$ curl -s http://127.0.0.1:3001/ -H "Cookie:"
  Securing your session      <- present (spinner only)
  Mark Kowalski     = 0     <- no shell markup
  Apex Plumbing     = 0
  data-sidebar      = 0
  Book Job          = 0
  Overview Dashboard= 0
  Book Manual Job   = 0
```

Client then redirects to `/auth` (200). This is the brief's guard behaviour: the shell never
paints for an unauthenticated user.

**Authenticated shell + live data.** Demo login → `/` renders sidebar, header
(`Apex Plumbing & Mechanical / Overview Dashboard`) and the placeholder. `/api/neon/data`
returns HTTP 200 with 1 org, and sidebar badges match the DB exactly — `Dispatch Board 5`,
`SMS Inbox 5`, `Missed Calls 2` (unread 5, unconverted 2) against 5 bookings / 4 threads /
3 missed calls / 5 services / 1 customer.

**All 8 nav destinations** verified live:

| Item | Destination | Highlight |
|---|---|---|
| Overview | `/` | ✅ active |
| Dispatch Board | `/dispatch` | 404 (task 5) |
| SMS Inbox | `/sms` | 404 (task 6) |
| Missed Calls | `/missed-calls` | 404 (task 7) |
| Customers | `/customers` | 404 (task 4/5) |
| Organization | `/settings?tab=general` | 404 (task 9) |
| Service Rates | `/settings?tab=rates` | 404 (task 9) |
| AI Dispatcher | `/settings?tab=ai_dispatcher` | 404 (task 9) |

`getTabTitle` was extracted from `Header.tsx` and executed in isolation; all pathname→title and
pathname+subtab→title mappings from the brief match exactly. The non-overview rows 404 **by
design** until tasks 4–9 land, so their highlight state could not be observed at runtime — it was
verified by code inspection instead (it is a pure `pathname === href` comparison in
`AppSidebar`).

**Sync Data.** Click → toast `Syncing live data from database...`, button becomes
disabled `Syncing...`, a second `/api/neon/data` request lands, then the label reverts to
`Sync Data` and badges are re-derived from the response. No flash, no stale state.

**Booking (both entry points, end-to-end into Postgres).**
1. Header `Book Job` → modal opens, `Create New Dispatch Job`, 8 real availability slots fetched
   from `/api/availability`, no React error, shell stays alive.
2. Sidebar `+ Book Manual Job` → same modal. Open→close→open is stable (this is the regression
   the D1 fix addresses; it was not stable before).
3. Submit → `POST /api/bookings` → sidebar `Dispatch Board` went **4 → 5**, modal closed.
4. Independent re-read of `/api/neon/data` confirms the row is in the live DB with a real UUID:

```json
{"id":"1b0d77bb-d7df-4344-940d-4663779e20d3","customerName":"Vera Tasknine","status":"scheduled",
 "timeSlot":"12:00 PM - 2:00 PM","estimateAmount":770,"createdFrom":"manual"}
```

This is a real persisted booking, not optimistic local state.

**Technician status toggle.** Both segment buttons and the avatar button flip state and the
`title` reflects it: `Status: On Service Call. Click to toggle.` ⇄ `Status: Available. Click to
toggle.`, with `bg-amber-100` / `bg-emerald-100` tracking the active segment.

**Org switcher.** Selecting the org fires the POST and toasts
`Switched workspace to Apex Plumbing & Mechanical`, then re-syncs.

**Sign out.** Header `Sign Out` (icon-only button, `title="Sign Out"`) → redirect to `/auth`,
shell unmounts, and the session is genuinely gone:

```
$ curl -s http://127.0.0.1:3000/api/auth/me
{"success":true,"user":null}
```

---

## 6. Findings for the controller

1. **Pre-existing crash in `src/components/NewBookingModal.tsx`** (D1). The root Vite app's
   "Book" button currently blanks the page. Fixed in `apps/web`, **not** in `src/`. If the root
   app is still reachable by anyone, it needs the same one-line move.
2. **`AGENTS.md` is wrong about `/api/neon/execute-sql`.** The doc lists it as an auth'd
   arbitrary-SQL endpoint; `grep` finds no such route in `server.ts` (the only `/api/neon/*`
   routes are `status`, `test-function`, `data`). Both `GET` and `POST` to it return the JSON
   404 `{"error":"No API route matches …"}`. Doc drift, not a live hole.
3. **`scheduled_date` is off by one day for the current timezone.** A booking submitted for
   `2026-09-28` reads back as `date: "2026-09-27"` from `/api/neon/data`. Cause is
   `server.ts:1231` — `new Date(b.scheduled_date).toISOString().slice(0, 10)`: `pg` hands back a
   JS `Date` in local time, and `toISOString()` reinterprets that instant as UTC, so any
   negative-offset server lands on the previous calendar day. The `typeof === 'string'` guard
   only helps when the driver returns text. Affects the `/api/neon/data`, booking-update and
   booking-list responses (lines 1231, 1652, 1758). **`server.ts` is out of task 3's scope, so
   I did not touch it** — but any date-keyed dashboard in tasks 4–9 will render bookings on the
   wrong day until this is fixed. Flagging as a likely blocker for the dispatch board.
4. **The Express server is reaped by the sandbox.** It died silently twice mid-session
   (no crash output, no error in the log) after several minutes of uptime, under two different
   launch methods (`Start-Process`, `nohup … & disown`). The Next dev server survived the whole
   session. This is an environment behaviour, not an app bug — but it is a trap: with the
   backend down, both apps silently fall back to `mockData.ts`, so the shell shows
   19 bookings / 1 unread / 1 unconverted instead of the real 5 / 5 / 2. Any future runtime
   check must confirm `GET /api/neon/status` is 200 **and** that `/api/neon/data` returns the
   tenant's row counts before trusting a screenshot.
5. **Modal's own native validation is stricter than its API.** The Quote Estimate input is
   `min=0 step=10`, so a value like `775` is rejected by the browser's constraint validation
   ("The two nearest valid values are 770 and 780") and the form never submits — the handler is
   never reached. Not a defect, but it will look like a dead Save button in manual testing.

---

## 7. Idempotency / retry / failure-mode notes

- `syncFromNeon` is the only shared read path; each of its 8 parallel `/api/neon/data` reads is
  independently `.catch`-guarded so one failed slice cannot reject the whole sync.
- All mutations are optimistic-then-PATCH (status, settings, service delete) and keep their
  existing `console.warn` failure handling; none of them retry, by design — they are
  fire-and-forget UI updates, and the next `syncFromNeon` reconciles from the server.
- `handleAddBooking`, `handleAddService`, `handleUpdateOrg` are the exception: they `await`, and
  `handleAddBooking` / `handleUpdateOrg` roll back local state on failure and surface a toast.
  `handleAddBooking` re-inserts the **server-returned** row (with its real UUID), not the local
  one, so the client never invents an ID the database did not issue.
- `apiFetch` gives every one of those calls a readable error instead of a JSON parse error,
  which is what surfaced finding 4's silent mock-data fallback during this session.
- No queue, job, or webhook is touched by this task.
