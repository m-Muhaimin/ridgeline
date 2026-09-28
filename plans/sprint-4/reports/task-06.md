# Task 6 report — SMS page (`/sms`)

**Status:** complete. All three gates green. No servers booted (wave rule respected).

## Files (all Create, exactly the three I own)

| File | Action | Source |
|---|---|---|
| `apps/web/components/SmsInbox.tsx` | copied byte-identical | `src/components/SmsInbox.tsx` (667 lines) |
| `apps/web/components/SimulateSmsModal.tsx` | copied byte-identical | `src/components/SimulateSmsModal.tsx` (180 lines) |
| `apps/web/app/(dashboard)/sms/page.tsx` | written per brief | port of `src/App.tsx:873-891` + page-level Simulate trigger |

Nothing else was created, edited, or deleted. `git status` for my paths:

```
?? apps/web/app/(dashboard)/sms/page.tsx
?? apps/web/components/SimulateSmsModal.tsx
?? apps/web/components/SmsInbox.tsx
```

(`server.ts` and `src/components/NewBookingModal.tsx` show as modified in `git status`, but both were
already modified before this task started — same state as the pre-work `git status` snapshot. I did not
touch them, nor task 3's shell/provider, nor task 2's `lib/`, nor task 7's missed-call files.)

## Byte-identical copies confirmed

Both files were copied with `cp` (no re-typing, no reformatting), then verified two ways:

```
$ diff src/components/SmsInbox.tsx apps/web/components/SmsInbox.tsx
$ diff src/components/SimulateSmsModal.tsx apps/web/components/SimulateSmsModal.tsx
DIFF_CLEAN_EXIT=0
$ md5sum src/components/SmsInbox.tsx apps/web/components/SmsInbox.tsx \
          src/components/SimulateSmsModal.tsx apps/web/components/SimulateSmsModal.tsx
38ab2717228e8ad01e113dc3eac5aee9 *src/components/SmsInbox.tsx
38ab2717228e8ad01e113dc3eac5aee9 *apps/web/components/SmsInbox.tsx
9695ba19bbfd89b82fde7f67cfd41900 *src/components/SimulateSmsModal.tsx
9695ba19bbfd89b82fde7f67cfd41900 *apps/web/components/SimulateSmsModal.tsx
```

`diff` clean on both pairs; MD5 pairs match. Line counts match the brief (667 / 180).

### Copy rules held

- `SmsInbox.tsx` keeps its `EmptyState` / `AIIcon` imports (both exist in `apps/web/components/` from
  task 3) and `../types` (resolves to `apps/web/types.ts`). Its auto-scroll refs, suggestion chips,
  slot-offer cards and takeover switch are untouched.
- `SimulateSmsModal.tsx` keeps its seeded opening message built from `settings.businessName`.
- Both copies' `lucide-react` icon imports resolve — `apps/web/node_modules` has the package and both
  typechecks pass.

## Page wiring

`apps/web/app/(dashboard)/sms/page.tsx` is exactly the brief's code block, character for character. It
is `'use client'`, imports only `useState` + the three local modules, and never calls `apiFetch`.

The `App.tsx:873-891` mapping is complete and correct:

| `SmsInbox` prop | passed as | note |
|---|---|---|
| `threads` | `threads` | from `useData()` |
| `activeThreadId` | `selectedThreadId` | `App.tsx` had `activeThreadId={selectedThreadId}` |
| `onSelectThread` | `selectThread` | provider's `selectThread` is `setSelectedThreadId` only (`DataProvider.tsx:665`) — no `router.push`, so no navigation loop on this page |
| `onSendMessage` | `handleSendMessage` | |
| `onProcessCustomerSms` | `handleProcessCustomerSms` | provider's single `POST /api/sms/process` site |
| `bookings` / `settings` / `services` | same names | |
| `onAutoConfirmFromSms` | `handleAutoConfirmFromSms` | provider returns `Promise<void>`; assignable to the `void` prop signature |
| `tradespersonStatus` / `setTradespersonStatus` | same names | |
| `user` | `currentUser` | `user={currentUser}`, not `user` |
| `onToggleTakeover` | `handleToggleTakeover` | |
| `onOpenSimulateSms` | **not passed** | page owns the trigger |

Simulate path, per the made decision: the page makes **no** API call. It passes the provider's
`handleSendTestSms` (`DataProvider.tsx:91`, signature `(text, customerName?, customerPhone?) =>
Promise<string>` — exactly `SimulateSmsModal`'s `onSendTestSms` prop type) straight through. The page
holds `const [isSimulateOpen, setSimulateOpen] = useState(false)`, renders a right-aligned
`text-xs font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer` "Simulate SMS" button in
a `flex justify-end` row above the inbox, and renders `<SimulateSmsModal>` next to (after) `<SmsInbox>`
inside the `space-y-4` wrapper.

The brief said to copy the button markup from `App.tsx` "if one exists". It does not — `grep -n
"Simulate SMS\|SimulateSmsModal" src/App.tsx` returns nothing (the modal was reachable from `SmsInbox`'s
own "Simulate Inbound" drawer, a different feature). So the brief's documented fallback markup was used
verbatim.

## Gate outputs (verbatim)

```
$ npx tsc --noEmit
ROOT_TSC_EXIT=0
```

(no output, exit 0)

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
ℹ duration_ms 1785.3373
```

```
$ npm --prefix apps/web run lint

> ridgeline-web@0.0.0 lint
> tsc --noEmit

WEB_LINT_EXIT=0
```

**159/159 pass, both typechecks exit 0.**

The root gate really does cover `apps/web` — `npx tsc --noEmit --listFilesOnly | grep -c "apps/web"`
returns `562`, so a bad import in my three files would have failed the root gate, as the brief warned.
None did.

## Deviations

None. All three files match the brief exactly; no scope crept in.

## Findings / notes for the controller

1. **Browser verification is outstanding, by design.** The brief's browser checklist (`/sms` render,
   thread swap, `POST /api/sms/message`, suggestion chips, takeover switch, and the Simulate gate —
   `POST /api/sms/process` 200 with `My basement pipe burst…`, then the auto-confirm path) could not be
   run: booting a server is forbidden in this wave. **The Simulate gate is the task's acceptance path
   and is still unproven at runtime.** Please cover it in the combined sweep. Highest-value single
   check: Simulate SMS → send the burst message → confirm exactly one `POST /api/sms/process` (the
   page has no second caller, so a duplicate would mean the provider, not this task).
2. **`SmsInbox` has an unrelated, pre-existing "Simulate Inbound" drawer** (lines 65, 135-141, 359-499)
   that calls `onProcessCustomerSms` directly via `handleSendSimulatedCustomerSms`. That is a *second*
   route into `POST /api/sms/process`, independent of the page-level modal. It is inside the verbatim
   copy, so it is intentional per the copy rules, but the brief's "no second call site" claim is true
   only of `handleSendTestSms` — worth remembering if the sweep sees two `/api/sms/process` hits.
3. **`onOpenSimulateSms` stays dead code** (`SmsInbox.tsx:40`, the only hit repo-wide). Left untouched
   per the brief. It is not in the destructure block, and neither tsconfig sets `noUnusedLocals`, so it
   raises no lint noise. Candidate for a later cleanup task — not this one.
4. **`settings.businessName` in the modal's seed message is hardcoded "Mark's"** — pre-existing copy
   from `src/components/SimulateSmsModal.tsx:19`, preserved verbatim. It will read oddly for a
   non-Mark org. Not mine to change.

## For Sentinel / Probe

- **Sentinel:** three files created, zero files modified outside them; no provider/`lib/`/shell edits;
  no `apiFetch` or direct fetch in the page; no `'use client'` inside `components/`.
- **Probe:** `/sms` on :3001 vs :3000 — thread list with unread badges, selected conversation, header
  "SMS Autonomous Inbox", sidebar highlight. Simulate gate as in finding 1. Auto-confirm: on slot
  conflict the toast shows the server's message and **no** local row is added.
