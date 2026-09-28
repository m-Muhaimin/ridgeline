# Task 9 — Services (`/services`) + Settings (`/settings?tab=`)

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §2.3, §3 row 9. Port of `src/App.tsx:918-991`.

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Data comes **only** from `useData()` (task 3's contract). No `apiFetch` in these pages.
3. Ported code is a move, not a redesign. No styling changes, no new dependencies, no API changes.
4. No `'use client'` inside `apps/web/components/**`; the page files start with `'use client'`.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint`.
6. **File-disjoint:** this task owns only the four files below. Never edit task 3's shell/provider or task 2's `lib/`.

## Goal
Two URLs onto one settings surface: `/services` renders the **rates** tab, `/settings?tab=general|ai_dispatcher|rates|billing` renders the tab named by the query param (default `general`). Both render the same `OrganizationSettings` panel, exactly as the Vite app does today (`App.tsx:985` — `activeSubTab={activeTab === 'services' ? 'rates' : settingsSubTab}`).

## Files (all **Create**)
| File | Source |
|---|---|
| `apps/web/components/OrganizationSettings.tsx` | copy of `src/components/OrganizationSettings.tsx` (758 lines) + 3 pinned edits |
| `apps/web/components/OrganizationSettingsPanel.tsx` | new: the single shared prop-wiring for both routes |
| `apps/web/app/(dashboard)/services/page.tsx` | new: `/services` → `rates` |
| `apps/web/app/(dashboard)/settings/page.tsx` | new: `/settings?tab=` |

### Do NOT port `SettingsView.tsx` or `ServiceCatalog.tsx`
Both are **dead code** in the current app: `rg -n "SettingsView|ServiceCatalog" src/` shows only their own definition lines and the two unused imports at `src/App.tsx:11-12` — neither is ever rendered (`App.tsx:919-991` renders `OrganizationSettings`, which contains its own inline general / rates / ai_dispatcher / billing panels and its own `handleSaveAi`). Porting them would create a second, competing settings UI. Do not port them; task 10 deletes them with `src/`. Flag this in your report.

## `OrganizationSettings.tsx` — copy rules (3 pinned edits only)
Everything else — the banner, the four-tab bar, the org form with its timezone `<select>`, the rates CRUD, the AI dispatcher form, the billing panel, every `showToast` string — is copied byte-for-byte.
1. `import { SettingsSubTab } from '../types';` (it moved to `types.ts` in task 2) and add `export type { SettingsSubTab };` so the file's public shape is unchanged for importers.
2. Add after the existing `useState` (line 50) so the panel follows URL changes:
   ```tsx
   useEffect(() => { setCurrentTab(activeSubTab); }, [activeSubTab]);
   ```
   (plus `useEffect` in the `react` import). Without this the tab bar desyncs from the URL on back/forward and on `router.replace`.
3. Prop names stay identical: `currentOrg, onUpdateOrg, settings, onUpdateSettings, services, onAddService, onDeleteService, activeSubTab, onChangeSubTab, showToast, onOpenOnboarding, onLogout`.

## `components/OrganizationSettingsPanel.tsx` — one wiring, two routes
```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useData } from './DataProvider';
import { OrganizationSettings } from './OrganizationSettings';
import type { SettingsSubTab } from '../types';
```
(It lives at `apps/web/components/`, hence `./DataProvider` and `../types`.) It takes one prop:
```tsx
export function OrganizationSettingsPanel({ tab, onTabChange }: {
  tab: SettingsSubTab;
  onTabChange: (tab: SettingsSubTab) => void;
}) {
  const router = useRouter();
  const { currentOrg, handleUpdateOrg, settings, handleUpdateSettings, services,
          handleAddService, handleDeleteService, showToast, handleLogout, setSettingsSubTab } = useData();
  return (
    <OrganizationSettings
      currentOrg={currentOrg}
      onUpdateOrg={handleUpdateOrg}
      settings={settings}
      onUpdateSettings={handleUpdateSettings}
      services={services}
      onAddService={handleAddService}
      onDeleteService={handleDeleteService}
      activeSubTab={tab}
      onChangeSubTab={onTabChange}
      showToast={showToast}
      onOpenOnboarding={() => router.push('/onboarding')}
      onLogout={handleLogout}
    />
  );
}
```
That is the one-to-one mapping of `App.tsx:920-990`; `handleUpdateOrg` is the renamed inline `onUpdateOrg` closure (optimistic set + `PATCH /api/organizations` + re-sync from `res.organization` + revert + toast on failure — that logic now lives in the provider, ported verbatim).

## `app/(dashboard)/services/page.tsx` — the whole file
```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useData } from '../../../components/DataProvider';
import { OrganizationSettingsPanel } from '../../../components/OrganizationSettingsPanel';

export default function ServicesPage() {
  const router = useRouter();
  const { setSettingsSubTab } = useData();
  return (
    <OrganizationSettingsPanel
      tab="rates"
      onTabChange={(tab) => {
        setSettingsSubTab(tab);
        router.push(tab === 'rates' ? '/services' : `/settings?tab=${tab}`);
      }}
    />
  );
}
```
No `useSearchParams` here, so `/services` stays statically prerenderable.

## `app/(dashboard)/settings/page.tsx` — URL is the source of truth
```tsx
'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useData } from '../../../components/DataProvider';
import { OrganizationSettingsPanel } from '../../../components/OrganizationSettingsPanel';
import type { SettingsSubTab } from '../../../types';

const VALID: SettingsSubTab[] = ['general', 'rates', 'ai_dispatcher', 'billing'];
function SettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('tab');
  const tab: SettingsSubTab = (VALID.includes(raw as SettingsSubTab) ? raw : 'general') as SettingsSubTab;
  const { settingsSubTab, setSettingsSubTab } = useData();
  useEffect(() => { if (settingsSubTab !== tab) setSettingsSubTab(tab); }, [tab, settingsSubTab, setSettingsSubTab]);
  return (
    <OrganizationSettingsPanel
      tab={tab}
      onTabChange={(next) => { setSettingsSubTab(next); router.replace(`/settings?tab=${next}`, { scroll: false }); }}
    />
  );
}
export default function SettingsPage() {
  return <Suspense fallback={null}><SettingsInner /></Suspense>;
}
```
The `Suspense` boundary is **required** — `useSearchParams()` without one fails `next build` with "useSearchParams() should be wrapped in a suspense boundary". The `settingsSubTab` sync effect is what makes the task-3 sidebar highlight follow a deep link or the back button; it writes only to the provider (no navigation, no loop, because the effect no-ops once the values match).

## Verification
```bash
npx tsc --noEmit && npm test && npm --prefix apps/web run lint
npm --prefix apps/web run build     # run it: it is the proof the Suspense boundaries hold
```
Browser, logged in on :3001:
- `/services` opens the **rates** panel; the header reads "Organization Settings · Service Rates"; the sidebar highlights Service Rates.
- `/settings` opens the **general** panel by default; header reads "Organization Settings · Profile".
- `/settings?tab=ai_dispatcher` deep-links straight to the AI dispatcher form; `/settings?tab=bogus` falls back to `general`.
- Clicking each of the four tabs updates the URL via `replace` (no history spam), swaps the panel, and the header title follows.
- Navigating back/forward keeps the URL, panel and sidebar highlight in sync.
- Editing the org (name + timezone) → `PATCH /api/organizations` → success toast; an invalid timezone is rejected by the server and the form **reverts** with the error toast (the provider's revert path).
- Add a service → `POST /api/services` and the catalog row; delete → `DELETE /api/services/:id` + "Service removed from catalog." toast.
- Saving the AI dispatcher rules → `PATCH /api/assistant-settings` + toast.
- The banner's onboarding (Compass) button routes to `/onboarding`; the logout button signs out.

## Non-goals
No provider changes, no port of `SettingsView`/`ServiceCatalog`, no new settings fields, no styling changes, no `/settings/...` nested routes, no middleware.

## Where it fits
One of the five file-disjoint page tasks (4–9) that run in parallel on top of the frozen task-3 shell + `useData()` contract. It is the only task that owns the settings sub-tab URL contract, and the only page besides `/` that maps onto a panel rather than a dedicated view component.
