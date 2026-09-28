# Task 9 report — Services (`/services`) + Settings (`/settings?tab=`)

**Status:** complete. All three static gates green + `next build` exit 0. No server booted (controller owns the runtime/browser sweep).

## Files (exactly the 4 the brief grants — nothing else touched)

| File | Action | Provenance |
|---|---|---|
| `apps/web/components/OrganizationSettings.tsx` | Create | `cp` of `src/components/OrganizationSettings.tsx` + the 3 pinned edits |
| `apps/web/components/OrganizationSettingsPanel.tsx` | Create | brief lines 39-70, verbatim |
| `apps/web/app/(dashboard)/services/page.tsx` | Create | brief lines 76-93, verbatim |
| `apps/web/app/(dashboard)/settings/page.tsx` | Create | brief lines 99-123, verbatim (Suspense wrapper included) |

Line counts: 766 / 41 / 29 / 39.

### File-disjointness (mtime sweep over every `apps/web/**` `.ts`/`.tsx`)

- **Mine, 13:32-13:33:** `OrganizationSettings.tsx`, `OrganizationSettingsPanel.tsx`,
  `app/(dashboard)/services/page.tsx`, `app/(dashboard)/settings/page.tsx` — nothing else.
- **Other tasks in the wave, 13:26-13:31:** `ChartSkeleton`, `CompletedBookingsChart`,
  `MetricCards`, `(dashboard)/page.tsx` (task 4); `SmsInbox`, `MissedCallsView`,
  `SimulateCallModal`, `SimulateSmsModal`, `(dashboard)/sms/page.tsx` (13:30);
  `CustomersView`, `DispatchBoard`, `(dashboard)/customers|dispatch|missed-calls/page.tsx` (13:31).
- **Frozen, all pre-13:14 and untouched:** task 3 `DataProvider.tsx` 13:11,
  `DashboardShell.tsx` 12:44, `AppSidebar.tsx` 12:43, `Header.tsx` 12:44,
  `NewBookingModal.tsx` 12:57, `(dashboard)/layout.tsx` 12:44; task 2 `lib/*` + `mockData.ts`
  12:35, `types.ts` 12:36. Root `package.json` / `bun.lock` / `tsconfig.json` untouched.

## `OrganizationSettings.tsx` — the copy, and the exact deltas

`cp`, not a re-type. The two files hashed **identically** immediately after the copy:

```
aec0d7a239f0d75b8c119acb6a27e9e0 *src/components/OrganizationSettings.tsx
aec0d7a239f0d75b8c119acb6a27e9e0 *apps/web/components/OrganizationSettings.tsx
```

Then the 3 pinned edits, and nothing else. `diff -u` src → apps/web, complete and verbatim:

```diff
--- src/components/OrganizationSettings.tsx	2026-09-28 06:29:25.491849400 +0600
+++ apps/web/components/OrganizationSettings.tsx	2026-09-28 13:32:38.329700600 +0600
@@ -1,4 +1,4 @@
-import React, { useState } from 'react';
+import React, { useState, useEffect } from 'react';
 import { listTimeZones, groupTimeZones, timeZoneOptionLabel } from '../lib/timezones';
 import { 
   Building2, 
@@ -12,11 +12,14 @@
   LogOut
 } from 'lucide-react';
 import { Organization, AssistantSettings, TradeService, TradeType } from '../types';
+import { SettingsSubTab } from '../types';
 import { formatCurrency } from '../lib/utils';
 import { RidgeLineLogo } from './RidgeLineLogo';
 import { AIIcon } from './AIIcon';
 
-export type SettingsSubTab = 'general' | 'rates' | 'ai_dispatcher' | 'billing';
+// SettingsSubTab now lives in ../types (task 2). Re-exported so importers of
+// this module see the same public shape they did in the Vite app.
+export type { SettingsSubTab };
 
 interface OrganizationSettingsProps {
   currentOrg: Organization;
@@ -48,7 +51,12 @@
   onLogout,
 }) => {
   const [currentTab, setCurrentTab] = useState<SettingsSubTab>(activeSubTab);
-  
+
+  // The bar follows the URL, not just the click. In App.tsx this state only
+  // moved through handleTabChange, so back/forward and an outside
+  // router.replace() left the bar highlighting the wrong tab.
+  useEffect(() => { setCurrentTab(activeSubTab); }, [activeSubTab]);
+
   // Organization form state
   const [orgForm, setOrgForm] = useState<Organization>({
     ...currentOrg,
```

Mapping to the brief's numbered edits:

1. **Type moved to `../types`.** Local `export type SettingsSubTab = ...` (line 19) replaced
   by `import { SettingsSubTab } from '../types';` + `export type { SettingsSubTab };`,
   which the brief specifies. Kept as a second `../types` import line, literally as written,
   rather than merged into the existing one on line 14.
2. **`useEffect` added to the `react` import, and the sync effect placed immediately after
   the existing `useState` on line 50** — `const [currentTab, setCurrentTab] = useState<SettingsSubTab>(activeSubTab);`
   is the actual line 50 in the source (verified by reading the copy, not assumed), and the
   effect goes right below it. The blank line above `// Organization form state` is the
   source's whitespace-only line 51, now carrying the effect.
3. **Prop names unchanged** — verified, no diff hunk touches `interface OrganizationSettingsProps`
   or the destructure: `currentOrg, onUpdateOrg, settings, onUpdateSettings, services,
   onAddService, onDeleteService, activeSubTab, onChangeSubTab, showToast, onOpenOnboarding, onLogout`.
   All 12 present, none renamed.

Everything else is byte-identical: the banner (org name, trade, plan pills, "Launch Setup
Wizard", "Sign Out", RidgeLine number), the four-tab bar and its `currentTab === '…'`
highlight ladder, the general form with the grouped timezone `<select>`, the Calling block,
the rates CRUD + Add Service drawer, the AI dispatcher tone/route/emergency-keyword form and
its own `handleSaveAi`, the billing panel, and every `showToast` string.

**The re-export has a real purpose.** In the Vite app `SettingsSubTab` was imported *from this
module* by `src/App.tsx:13`, `src/components/AppSidebar.tsx:32` and
`src/components/Header.tsx:5`. Inside `apps/web` nothing imports it from here (task 2/3 import
`../types`), so the re-export is currently a no-op that preserves the public shape as the brief
requires. `export type { … }` is required under `isolatedModules` (set in both tsconfigs) — a
bare `export { SettingsSubTab }` would error.

Copy imports resolve unchanged at the same relative depth (`../lib/timezones`, `../lib/utils`,
`../types`, `./RidgeLineLogo`, `./AIIcon`): `diff src/lib/timezones.ts apps/web/lib/timezones.ts`
and `diff src/lib/utils.ts apps/web/lib/utils.ts` are both empty, and
`diff src/components/RidgeLineLogo.tsx apps/web/…` and `src/components/AIIcon.tsx` likewise.
No `apiFetch` in any of the four files (`rg -n "apiFetch" <4 files>` → no match) — global
constraint #2 holds.

## The two routes' wiring

`App.tsx:920-990` rendered `OrganizationSettings` inline under
`(activeTab === 'settings' || activeTab === 'services')`. That inline prop list is now
`OrganizationSettingsPanel`, used by both routes, and `App.tsx:985`'s
`activeSubTab={activeTab === 'services' ? 'rates' : settingsSubTab}` is now the route's
decision:

| | `/services` | `/settings?tab=` |
|---|---|---|
| source of the shown tab | hardcoded `tab="rates"` | `VALID.includes(raw) ? raw : 'general'`, default `general` |
| unknown `?tab=bogus` | n/a (no search params) | falls back to `general` |
| tab click | `router.push(tab === 'rates' ? '/services' : '/settings?tab=${tab}`)` | `router.replace('/settings?tab=${next}', { scroll: false })` |
| provider write | `setSettingsSubTab(tab)` in the click handler | `setSettingsSubTab(next)` in the click handler **+** the one-way sync `useEffect` |
| `useSearchParams` | not used → statically prerenderable | used, inside `<Suspense fallback={null}>` |

- `handleUpdateOrg` is the provider's renamed inline `onUpdateOrg` closure (optimistic set →
  `PATCH /api/organizations` → re-sync from `res.organization` → revert + error toast),
  ported verbatim in task 3's `DataProvider.tsx:578-604`. `onOpenOnboarding` becomes
  `router.push('/onboarding')` (was `navigate('/onboarding')`), `onLogout` is `handleLogout`.
- Both routes are `○ (Static)` in the build output — neither is dynamic.
- The build proves the settings page's Suspense boundary holds, with a caveat below.

## Dead code — confirmed, not ported

```
$ rg -n "SettingsView|ServiceCatalog" src/
src/App.tsx:11:import { ServiceCatalog } from './components/ServiceCatalog';
src/App.tsx:12:import { SettingsView } from './components/SettingsView';
src/components/ServiceCatalog.tsx:7:interface ServiceCatalogProps {
src/components/ServiceCatalog.tsx:13:export const ServiceCatalog: React.FC<ServiceCatalogProps> = ({
src/components/SettingsView.tsx:15:interface SettingsViewProps {
src/components/SettingsView.tsx:20:export const SettingsView: React.FC<SettingsViewProps> = ({
```

Six hits, all definitions or the two unused imports. `src/App.tsx:918-991` renders
`OrganizationSettings`, so neither is ever mounted — the brief is right that porting them
would add a competing settings UI. **`SettingsView.tsx` and `ServiceCatalog.tsx` were not
ported; task 10 owns deleting them with `src/`.**

## Verification

Baseline before I started: `npx tsc --noEmit` 0, `npm test` 159/159, web lint 0. After:

```
$ npx tsc --noEmit
exit: 0

$ npm test
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
exit: 0

$ npm --prefix apps/web run lint

> ridgeline-web@0.0.0 lint
> tsc --noEmit

exit: 0
```

The root gate really does cover `apps/web` (no `include` in the root `tsconfig.json`):
`npx tsc --noEmit --listFiles` lists 566 files under `apps/web`, including all four of mine —
so a bad import in these files would break the **root** gate, as the controller noted. It does
not.

```
$ npm --prefix apps/web run build
> ridgeline-web@0.0.0 build
> next build

▲ Next.js 16.3.6 (Turbopack)
⚠ Warning: Next.js ignored package-lock.json in C:\Users\muhai because it is outside the current Git repository (C:\Users\muhai\Downloads\remix-ridgeline).
 To use this directory, set `turbopack.root` in your Next.js config.

⚠ Warning: Next.js inferred your workspace root, but it may not be correct.
 We detected multiple lockfiles and selected the directory of C:\Users\muhai\Downloads\remix-ridgeline\package-lock.json as the root directory.
 To silence this warning, set `turbopack.root` in your Next.js config, or consider removing one of the lockfiles if it's not needed.
   See https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory for more information.
 Detected additional lockfiles: 
   * C:\Users\muhai\Downloads\remix-ridgeline\apps\web\package-lock.json

✓ Running next.config.ts took 46ms

  Creating an optimized production build ...
✓ Compiled successfully in 988ms
  Running TypeScript ...
  Finished TypeScript in 2.4s ...
  Collecting page data using 7 workers ...
  Generating static pages using 7 workers (0/12) ...
  Generating static pages using 7 workers (3/12) 
  Generating static pages using 7 workers (6/12) 
  Generating static pages using 7 workers (9/12) 
✓ Generating static pages using 7 workers (12/12) in 560ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /auth
├ ○ /customers
├ ○ /dispatch
├ ○ /health
├ ○ /missed-calls
├ ○ /onboarding
├ ○ /services
├ ○ /settings
└ ○ /sms


○  (Static)  prerendered as static content

build exit: 0
```

The two workspace-root warnings are pre-existing (`apps/web/package-lock.json` +
root `package-lock.json` both present, `turbopack.root` unset in `next.config.ts`) and
unrelated to this task — task 1's file, not mine. The route list includes the other four
agents' pages, so the build also compiled theirs cleanly at the time it ran.

## Findings / deviations

1. **The brief's Suspense claim does not reproduce on Next 16.3.6 — the build is a weaker
   proof than the brief assumes.** The brief says `useSearchParams()` without a boundary
   "fails `next build` with *useSearchParams() should be wrapped in a suspense boundary*". I
   tested it: I removed the `<Suspense>` wrapper from my own settings page, ran
   `npm --prefix apps/web run build`, and got **exit 0, compiled successfully, and `/settings`
   still `○ (Static)`** — no such error anywhere in the output. I then restored the file
   (md5 back to `99c6afdbaacf389bfe0111617c19a7b5`, re-verified, rebuilt green). So the
   boundary is *not* load-bearing for `next build` in this version. I kept it anyway: the
   brief requires it, it is the documented-correct pattern, and it is what guards the
   client-side "missing suspense boundary" bailout and any future switch to stricter
   prerender checks. But Sentinel should not treat a green `next build` as proof the
   boundary is *needed* — and Probe should confirm in the browser that `/settings?tab=billing`
   hydrates and paints with no console error, since that part is now the only real check.
2. **`'use client'` in `OrganizationSettingsPanel.tsx` contradicts the brief's own global
   constraint #4** ("No `'use client'` inside `apps/web/components/**`; the page files start
   with `'use client'`"). The brief's file listing for the panel literally starts with
   `'use client';` — no file in `apps/web/components/` has one today (`rg -l "^'use client'"`
   over `components/` → empty; `DashboardShell.tsx`, `Header.tsx`, `AppSidebar.tsx`,
   `DataProvider.tsx` all rely on the page's directive propagating). I followed the brief's
   literal code and kept it. It is functionally inert (the panel is only ever imported by a
   client page) and nothing flags it — web lint is bare `tsc --noEmit` with no
   `noUnusedLocals`/`noUnusedParameters`, and the build compiles it. If you want constraint #4
   to win, it is a one-line delete at `OrganizationSettingsPanel.tsx:1`; say the word.
3. **`setSettingsSubTab` is destructured in the panel and never used** (brief line 53, kept
   verbatim). Both pages set the sub-tab themselves, so the panel has no use for it. Harmless
   — no lint rule fires — but it is a dead binding. Left in because the brief gives the whole
   file; flagging rather than silently deviating.
4. **`settingsSubTab` ↔ `?tab=` sync, precisely how it behaves.** The URL is the source of
   truth; the provider is a one-way mirror, so there is no loop. The effect writes only when
   `settingsSubTab !== tab`, and `setSettingsSubTab` is a `useState` setter (stable identity),
   so the dependency array cannot re-trigger on its own. Consequences worth knowing:
   - `Header.tsx:57-62` and `AppSidebar.tsx:193-231` read **`settingsSubTab`, not the query
     string** (task 3's design; `DashboardShell.tsx:98,120` passes it through). So on a **hard
     load / deep link** of `/settings?tab=billing` the header and sidebar first render from the
     provider default `'general'` and correct themselves **one render later**, when the sync
     effect writes `billing`. Expect a one-frame flash of "Organization Settings · Profile"
     on a cold deep link. Not stuck, not a bug — a single extra render. Worth a Probe look.
   - `/services` needs no such effect: `AppSidebar`'s Service Rates item is active on
     `isActive('/services')` regardless of `settingsSubTab`, and the Header's `/services`
     title is hardcoded to "Organization Settings · Service Rates". The panel's `rates` click
     on `/services` is a `router.push('/services')` to the route you are already on.
   - Sidebar "Service Rates" pushes `/settings?tab=rates` (task 3), **not** `/services`, so
     both the `/settings?tab=rates` and `/services` routes stay live. The panel's own tab bar
     is the only thing that routes to `/services`, and only from `/services` (`tab === 'rates'`
     → stay) or from a non-rates tab on `/services`. Asymmetric but intentional per the brief.
5. **New: form state resets on cross-route navigation (behaviour change, not fixable in this
   task).** `orgForm` and `aiForm` are `useState` initialisers seeded from `currentOrg` /
   `settings` and never re-sync — faithful to the source. But in the Vite app, tab switching
   was local state and nothing remounted; now leaving the route entirely (`/settings` →
   `/services`, or a refresh) unmounts the panel and re-seeds both forms from the provider,
   so **unsaved org-form edits are dropped**. A `?tab=` change stays on the same route, so
   in-page tab switching is unaffected. A fix is a second sync effect on `orgForm`/`aiForm` —
   i.e. a **4th edit**, which "3 pinned edits only" forbids. Flagged for a follow-up ticket
   rather than fixed here.
6. **Inert placeholder carried over.** Line 66 keeps
   `email: currentOrg.email || 'dispatch@apexplumbingpro.com'` — a Vite-era `import.meta.env`
   placeholder, not a real address. It only shows if `currentOrg.email` is falsy, and task 2's
   `mockData.ts` seeds every org with its own `__VG_EMAIL_*` placeholder, so it should not
   surface. Byte-for-byte per the brief; noting it because it would look alarming in a
   screenshot if a Neon org row ever lacks an email.
7. **Hardcoded billing numbers** (`$79.00 / mo`, next renewal `Oct 15, 2026`, `482 Texts`,
   `22 of 25 (88%)`, `$14,850`, `Visa ending in 4921 (Expires 08/28)`) are static strings in
   the source, not computed. Copied verbatim; the renewal date will read stale.
8. `next build` needed no `--no-lint` / no turbopack workaround, and no root config change.

## Handoff notes

- **Probe (:3001, logged in):** the brief's browser list is correct as written — `/services`
  → rates with header "Organization Settings · Service Rates"; `/settings` → general;
  `?tab=ai_dispatcher` deep-links; `?tab=bogus` → general; four tab clicks `replace` the URL
  with no history spam; back/forward keeps panel + sidebar + header aligned. Add: check the
  dev console on `/settings?tab=billing` (finding #1) and check whether the header flashes
  "Profile" once on a cold deep link (finding #4).
- **Sentinel (audit):** finding #1 (the Suspense boundary is not load-bearing for
  `next build` on 16.3.6 — verified by removing it), finding #2 (a `'use client'` directive
  inside `components/`, which the brief's own constraint #4 forbids), finding #3 (dead
  binding), and finding #5 (unsaved org-form edits lost on cross-route navigation).
- **Task 10:** `SettingsView.tsx` and `ServiceCatalog.tsx` are confirmed dead and unported;
  delete them with `src/`.
- Nothing else is pending from me. No `npm run dev` / `next dev` was started, no test files
  touched, and no file outside my four was modified.
