# Task 6 — SMS page (`/sms`)

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §3 row 6. Port of `src/App.tsx:873-891`.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Data comes **only** from `useData()` (task 3's contract). All API access lives in the provider.
3. Ported code is a move, not a redesign: class names, copy, layout, component internals copied verbatim.
4. No `'use client'` inside `apps/web/components/**`; the page itself starts with `'use client'`.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint`.
6. **File-disjoint:** this task owns only the three files listed below. Never edit task 3's shell/provider or task 2's `lib/`.

## Goal
Stand up `/sms` rendering `SmsInbox` with the full conversation surface (thread list, message pane, AI suggestion chips, human takeover), and add the `SimulateSmsModal` that exercises `POST /api/sms/process`.

## Files (all **Create**)
| File | Source |
|---|---|
| `apps/web/components/SmsInbox.tsx` | copy of `src/components/SmsInbox.tsx` (667 lines, **verbatim**) |
| `apps/web/components/SimulateSmsModal.tsx` | copy of `src/components/SimulateSmsModal.tsx` (180 lines, **verbatim**) |
| `apps/web/app/(dashboard)/sms/page.tsx` | port of `App.tsx:873-891` + the modal trigger |

## Decision (made — do not re-litigate): who calls `/api/sms/process`
The page does **not** call the API. It passes the provider's `handleSendTestSms` straight into `SimulateSmsModal`'s `onSendTestSms` prop. `handleSendTestSms` (task 3, ported from `App.tsx:537-565`) is the only simulate-path caller: it resolves/creates the thread, calls `handleProcessCustomerSms` (the single `POST /api/sms/process` site, with its rule-based `detectEmergency` fallback), pushes the customer + assistant messages via `handleSendMessage`, and auto-confirms when `shouldConfirmBooking` is set. There is no second call site and no duplicated fallback.

## Decision: the simulate trigger is page-level
`SmsInbox` declares `onOpenSimulateSms?: () => void` in its props type but **never reads it** (grep: `src/components/SmsInbox.tsx:40` is the only hit). So `SmsInbox` is copied verbatim and the page renders its own trigger. The page holds `const [isSimulateOpen, setSimulateOpen] = useState(false);`, renders a small button (copy the "Simulate SMS" button markup from `App.tsx`'s simulation affordance if one exists; otherwise `<button type="button" onClick={() => setSimulateOpen(true)} className="text-xs font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer">Simulate SMS</button>`) above the inbox, and renders `<SimulateSmsModal isOpen={isSimulateOpen} onClose={() => setSimulateOpen(false)} onSendTestSms={handleSendTestSms} settings={settings} />` next to `<SmsInbox />`.

## `app/(dashboard)/sms/page.tsx`
```tsx
'use client';
import { useState } from 'react';
import { useData } from '../../../components/DataProvider';
import { SmsInbox } from '../../../components/SmsInbox';
import { SimulateSmsModal } from '../../../components/SimulateSmsModal';

export default function SmsPage() {
  const {
    threads, selectedThreadId, selectThread, handleSendMessage, handleProcessCustomerSms,
    bookings, settings, services, handleAutoConfirmFromSms, tradespersonStatus,
    setTradespersonStatus, currentUser, handleToggleTakeover, handleSendTestSms,
  } = useData();
  const [isSimulateOpen, setSimulateOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setSimulateOpen(true)} className="text-xs font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer">Simulate SMS</button>
      </div>
      <SmsInbox
        threads={threads}
        activeThreadId={selectedThreadId}
        onSelectThread={selectThread}
        onSendMessage={handleSendMessage}
        onProcessCustomerSms={handleProcessCustomerSms}
        bookings={bookings}
        settings={settings}
        services={services}
        onAutoConfirmFromSms={handleAutoConfirmFromSms}
        tradespersonStatus={tradespersonStatus}
        setTradespersonStatus={setTradespersonStatus}
        user={currentUser}
        onToggleTakeover={handleToggleTakeover}
      />
      <SimulateSmsModal isOpen={isSimulateOpen} onClose={() => setSimulateOpen(false)} onSendTestSms={handleSendTestSms} settings={settings} />
    </div>
  );
}
```
That is the complete `App.tsx:874-890` mapping: `activeThreadId`←`selectedThreadId`, `onSelectThread`←`selectThread`, `user={currentUser}` (not `user`), and `onOpenSimulateSms` deliberately **not** passed (the page owns the trigger instead).

## Copy rules
- `SmsInbox.tsx`: byte-identical. Keep `EmptyState`/`AIIcon` imports (task 3), `../types`, `../lib/*` (task 2). Its internal refs, auto-scroll, suggestion chips, slot-offer cards and takeover switch are untouched.
- `SimulateSmsModal.tsx`: byte-identical, including its seeded opening message built from `settings.businessName`.

## Verification
```bash
npx tsc --noEmit && npm test && npm --prefix apps/web run lint
```
Browser, logged in on :3001:
- `/sms` shows the thread list with unread badges and the selected conversation; sidebar highlights SMS Inbox; header reads "SMS Autonomous Inbox". Compare against :3000.
- Selecting a thread swaps the message pane.
- Sending a message as the tradesperson appends it locally and fires `POST /api/sms/message`.
- An AI suggestion chip sends the message as the assistant with its `actionTag`.
- Human takeover switch flips `isTakenOver` and shows the taker's name.
- **Simulate gate (the task's acceptance path):** click "Simulate SMS" → the modal opens; send *"My basement pipe burst, water is spraying everywhere!"* → Network shows `POST /api/sms/process` (200) → the assistant reply renders in the modal, the thread is created/updated, and the badge count moves.
- Send a confirmation message (e.g. *"Yes, tomorrow at 10am works"*) → the auto-confirm path either calls `GET /api/availability` and toasts a proposed opening, or posts `POST /api/bookings`; on a slot conflict the toast shows the server's message and **no** local row is added.

## Non-goals
No provider changes, no direct `apiFetch` in the page, no `SmsInbox` edits, no styling changes, no new endpoints. Do not touch task 7's missed-call files.

## Where it fits
One of the five file-disjoint page tasks (4–9) that run in parallel on top of the frozen task-3 shell + `useData()` contract. `handleSendTestSms` is the contract item this task consumes.
