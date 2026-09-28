# Task 7 — Missed calls page (`/missed-calls`)

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §3 row 7. Port of `src/App.tsx:892-908`.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Data comes **only** from `useData()` (task 3's contract). Per-call API access inside a page is allowed **only** for the one-off simulate call pinned below.
3. Ported code is a move, not a redesign: class names, copy, layout, component internals copied verbatim.
4. No `'use client'` inside `apps/web/components/**`; the page itself starts with `'use client'`.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint`.
6. **File-disjoint:** this task owns only the three files listed below. Never edit task 3's shell/provider, task 2's `lib/`, or task 4's `ChartSkeleton.tsx`.

## Goal
Stand up `/missed-calls` rendering `MissedCallsView` (recovery table + 7-day bar chart) and wire `SimulateCallModal` to the real `POST /api/missed-call/process` endpoint.

## Files (all **Create**)
| File | Source |
|---|---|
| `apps/web/components/MissedCallsView.tsx` | copy of `src/components/MissedCallsView.tsx` (355 lines, **verbatim**) |
| `apps/web/components/SimulateCallModal.tsx` | copy of `src/components/SimulateCallModal.tsx` (186 lines, **verbatim**) |
| `apps/web/app/(dashboard)/missed-calls/page.tsx` | port of `App.tsx:893-908` + the simulate wiring |

`MissedCallsView` imports `{ TabChartSkeleton }` from `./ChartSkeleton` — that file is **task 4's copy**; import it, do not create a second one.

## Decision (made — do not re-litigate): the simulate handler
`App.tsx:897` passes `onOpenSimulateCall={() => {}}` with the comment *"Simulation disabled"*, so the modal is currently unreachable. This task makes it live, and the call it triggers is `POST /api/missed-call/process` — endpoint contract (verified in `server.ts:2528-2608`): request body `{ callerName, callerPhone, voicemailTranscript, settings }`; it generates the auto-textback (OpenAI-compatible → Gemini → hardcoded default), **inserts a `missed_calls` row**, and responds `{ autoSms }`. Because the row is written server-side, the page must re-sync afterwards — it cannot patch local state.

```tsx
'use client';
import { useState } from 'react';
import { useData } from '../../../components/DataProvider';
import { apiFetch } from '../../../lib/apiFetch';
import { MissedCallsView } from '../../../components/MissedCallsView';
import { SimulateCallModal } from '../../../components/SimulateCallModal';

export default function MissedCallsPage() {
  const { missedCalls, bookings, isDataLoading, openThreadForPhone, settings, showToast, syncFromNeon } = useData();
  const [isSimulateOpen, setSimulateOpen] = useState(false);

  const handleSimulateMissedCall = async (
    callerName: string, callerPhone: string, voicemail: string,
    urgency: 'routine' | 'urgent' | 'emergency',
  ) => {
    try {
      const data = await apiFetch('/api/missed-call/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ callerName, callerPhone, voicemailTranscript: voicemail, settings }),
      });
      await syncFromNeon(true);
      showToast(`Auto-textback sent to ${callerName}: ${data.autoSms}`);
    } catch (err: any) {
      showToast(err?.message || 'Missed call simulation failed.');
    }
  };

  return (
    <div className="space-y-4">
      <MissedCallsView
        missedCalls={missedCalls}
        bookings={bookings}
        onOpenSimulateCall={() => setSimulateOpen(true)}
        onOpenThreadForCaller={openThreadForPhone}
        isLoading={isDataLoading}
      />
      <SimulateCallModal isOpen={isSimulateOpen} onClose={() => setSimulateOpen(false)} onSimulateMissedCall={handleSimulateMissedCall} />
    </div>
  );
}
```
Notes on that mapping:
- `onOpenThreadForCaller={(phone) => { const match = threads.find(t => t.customerPhone === phone); if (match) { setSelectedThreadId(match.id); setActiveTab('sms'); } }}` → `openThreadForPhone` (the provider does the lookup, the set, and `router.push('/sms')`).
- `SimulateCallModal`'s prop is `onSimulateMissedCall`; `urgency` is accepted but **not** sent — the endpoint has no urgency field. Keep the parameter in the signature so the modal's contract is unchanged.
- `settings` is passed straight through; the server strips client-supplied LLM provider/base-URL/API keys (`stripServerOnlyAssistantKeys`).
- This is the **only** `apiFetch` call in any page file in the sprint. Everything else goes through the provider.

## Copy rules
- `MissedCallsView.tsx`: byte-identical. Keep `EmptyState`/`AIIcon` (task 3) and `../lib/chartUtils` (task 2) imports, its `onOpenSimulateCall` button, and its "Open SMS thread" per-row action.
- `SimulateCallModal.tsx`: byte-identical, including the seeded voicemail and the urgency selector.

## Verification
```bash
npx tsc --noEmit && npm test && npm --prefix apps/web run lint
```
Browser, logged in on :3001:
- `/missed-calls` renders the table + 7-day chart, with the sidebar highlighting Missed Calls and the header reading "Missed Call Recovery Pipeline". Compare against :3000.
- Loading state shows the tab skeleton; the pending-reply badge matches the sidebar count.
- "Simulate Call" (the button `App.tsx` could never reach) opens the modal; triggering it fires `POST /api/missed-call/process` (200), the new call appears in the table after `syncFromNeon`, and the toast quotes the generated `autoSms`.
- Clicking the per-row thread icon navigates to `/sms` with the matching thread selected.

## Non-goals
No provider changes, no new endpoints, no `MissedCallsView` edits, no styling changes. Do not touch task 6's SMS files.

## Where it fits
One of the five file-disjoint page tasks (4–9) that run in parallel on top of the frozen task-3 shell + `useData()` contract. Cross-task reads only: task 4's `ChartSkeleton.tsx`.
