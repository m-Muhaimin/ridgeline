# Task 3 — Dashboard shell + `DataProvider` (THE CONTRACT TASK)

> Sprint 4 plan: `plans/sprint-4/PLAN.md` §2.3, §3 row 3. **Tasks 4–9 are written against the `useData()` surface specified here. Implement it exactly.**

## Global constraints (binding on every Sprint 4 task)
1. `apps/web` is self-contained. Do NOT touch root `package.json`, `bun.lock`, or `tsconfig.json` in tasks 1–9.
2. Every `apps/web` API call goes through `apiFetch` with **relative** paths and `credentials: 'include'`.
3. Ported code is a move, not a redesign. No styling changes, no new dependencies, no API endpoints.
4. No `'use client'` inside `apps/web/components/**` or `apps/web/lib/**` — client boundary is the page/layout.
5. Gate: `npx tsc --noEmit` + `npm test` (159) + `npm --prefix apps/web run lint` + **`npm --prefix apps/web run build`**.
6. Relative imports only.

## Goal
Port the `App.tsx` orchestrator into two pieces: a `DataProvider` context (all state + all mutation handlers, names unchanged) and a `DashboardShell` (the sidebar/header/toast chrome + the route guard). From this task on, the shell files are **frozen** — tasks 4–9 are file-disjoint and must not edit them.

## Files (all **Create**)
| New file | Source |
|---|---|
| `apps/web/components/DataProvider.tsx` | new (port of `src/App.tsx:74-534` state + handlers) |
| `apps/web/components/DashboardShell.tsx` | new (port of `src/App.tsx:590-1029` chrome) |
| `apps/web/app/(dashboard)/layout.tsx` | new, ~15 lines |
| `apps/web/app/(dashboard)/page.tsx` | **placeholder** — task 4 overwrites it |
| `apps/web/components/ui/sidebar.tsx` | copy of `src/components/ui/sidebar.tsx` (verbatim) |
| `apps/web/components/ui/button.tsx` | copy of `src/components/ui/button.tsx` (verbatim; `../../lib/utils` still resolves) |
| `apps/web/components/RidgeLineLogo.tsx` | copy (verbatim) |
| `apps/web/components/AIIcon.tsx` | copy (verbatim) |
| `apps/web/components/EmptyState.tsx` | copy (verbatim) |
| `apps/web/components/OrgSwitcher.tsx` | copy (verbatim) |
| `apps/web/components/AppSidebar.tsx` | port — pathname-driven nav |
| `apps/web/components/Header.tsx` | port — title from pathname |
| `apps/web/components/NewBookingModal.tsx` | copy (verbatim) |

`NewBookingModal` is **task 3's** file (it is shell chrome: the Header, sidebar and overview all open it, and `App.tsx` renders it outside the tab sections). Task 4 only wires the "Add Manual Job" button to the provider's `setIsNewBookingOpen`.

## `DataProvider.tsx` — the contract Tasks 4–9 code against
Move every `useState` from `src/App.tsx:74-92` and `235-245` verbatim, seeding from `../mockData` exactly as today. Move `syncFromNeon` (`App.tsx:95-145`), the mount effect (`147-167`), `showToast` (`240-245`), `unreadSmsCount`/`unconvertedCallsCount` (`247-248`), `handleProcessCustomerSms` (`251-327`, incl. the `detectEmergency` rule-based fallback now imported from `../lib/triage`), `handleSendMessage` (`330-393`), `handleToggleTakeover` (`396-409`), `handleAutoConfirmFromSms` (`418-503`), `handleSendEtaSms` (`506-522`), `handleUpdateStatus` (`525-534`), `handleSendTestSms` (`537-565`), `handleSelectOrg` (`203-224`), `handleAddOrg` (`226-232`), `handleLogout` (`179-188`), plus the `onUpdateOrg` / `onUpdateSettings` / `onAddService` / `onDeleteService` / `onAddBooking` inline handlers from `App.tsx:922-1022`, renamed to the `handle*` names below. Route `handleLogout` to `router.push('/auth')` instead of `navigate('/auth')` (`useRouter` from `next/navigation`).
`handleAuthSuccess` and `handleOnboardingComplete` are **not** in the contract — tasks 2's pages navigate, and the layout re-syncs on mount.

```ts
export type TradespersonStatus = 'on_call' | 'available' | 'driving';
export interface SmsProcessResult {
  replyText: string; actionTag?: any; shouldConfirmBooking?: boolean; extractedDetails?: any;
}
export interface DataContextValue {
  currentUser: User | null;            // App.tsx:91
  isAuthLoading: boolean;              // App.tsx:92
  isDataLoading: boolean;              // App.tsx:88
  organizations: Organization[];       // 76  seeded initialOrganizations
  currentOrg: Organization;            // 77  seeded initialOrganizations[0]
  bookings: JobBooking[];              // 78
  threads: SmsThread[];                // 79
  missedCalls: MissedCall[];           // 80
  customers: Customer[];               // 81
  services: TradeService[];            // 82
  settings: AssistantSettings;         // 83
  selectedThreadId: string;            // 84
  tradespersonStatus: TradespersonStatus;            // 85
  setTradespersonStatus: (s: TradespersonStatus) => void;
  neonConnected: boolean;              // 86
  neonLatency: number;                 // 87
  unreadSmsCount: number;              // 247
  unconvertedCallsCount: number;       // 248
  isNewBookingOpen: boolean; setIsNewBookingOpen: (open: boolean) => void;   // 235
  toastMessage: string | null; showToast: (msg: string) => void;             // 238/240
  settingsSubTab: SettingsSubTab; setSettingsSubTab: (t: SettingsSubTab) => void;
  syncFromNeon: (showLoading?: boolean) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleSelectOrg: (org: Organization) => Promise<void>;
  handleAddOrg: (newOrg: Omit<Organization, 'id'>) => void;
  handleUpdateOrg: (updated: Organization) => void;
  handleUpdateSettings: (s: AssistantSettings) => void;
  handleAddService: (s: Omit<TradeService, 'id'>) => Promise<void>;
  handleDeleteService: (id: string) => void;
  handleAddBooking: (newJob: Omit<JobBooking, 'id' | 'createdAt'>) => Promise<void>;
  handleUpdateStatus: (id: string, newStatus: BookingStatus) => void;
  handleSendEtaSms: (booking: JobBooking) => void;
  selectThread: (threadId: string) => void;          // setSelectedThreadId only
  openThread: (threadId: string) => void;            // selectThread + router.push('/sms')
  openThreadForPhone: (phone: string) => void;       // find in threads, then openThread
  handleSendMessage: (threadId: string, text: string, sender: 'customer'|'assistant'|'tradesperson', actionTag?: SmsMessage['actionTag'], senderName?: string) => void;
  handleProcessCustomerSms: (threadId: string, incomingText: string) => Promise<SmsProcessResult>;
  handleAutoConfirmFromSms: (thread: SmsThread, details: any) => Promise<void>;
  handleToggleTakeover: (threadId: string, forceStatus?: boolean) => void;
  handleSendTestSms: (text: string, customerName?: string, customerPhone?: string) => Promise<string>;
}
export const DataProvider: React.FC<{ children: React.ReactNode }>;
export function useData(): DataContextValue;   // throws if used outside DataProvider
```
`settingsSubTab`/`setSettingsSubTab` are plain `useState<SettingsSubTab>('general')` living in the provider so the shell (task 3) and the `/settings` page (task 9) share one value without a second context. `openThread`/`openThreadForPhone` replace the `setSelectedThreadId(...); setActiveTab('sms')` pairs at `App.tsx:833-839` and `898-904`.

## `DashboardShell.tsx` — chrome + guard
Port of `App.tsx:590-1029`, minus the view sections. Renders, in order: the toast block (`596-601`, verbatim), `<AppSidebar …>` inside `<SidebarProvider defaultOpen={true}>`, `<SidebarInset className="flex flex-col flex-1 overflow-x-hidden min-w-0">` with `<Header …>` + `<main className="flex-1 p-3 sm:p-5 md:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0">{children}</main>`, then `<NewBookingModal isOpen={isNewBookingOpen} timeZone={currentOrg?.timezone || 'UTC'} onClose={() => setIsNewBookingOpen(false)} onAddBooking={handleAddBooking} services={services} />`. The outer wrapper div `App.tsx:593` (`flex min-h-screen w-full bg-neutral-50/70 text-neutral-900 font-sans`) is copied verbatim.
**Guard** (replaces `ProtectedRoute`, `App.tsx:47-70`): `isAuthLoading` → the exact spinner markup from `52-59`; `!currentUser` → `useEffect` `router.replace('/auth')`, render `null`; `!currentUser.onboardingCompleted` → `router.replace('/onboarding')`, render `null` (the pathname check at `App.tsx:65` is unnecessary: `/onboarding` lives outside this layout). Otherwise render the chrome. No `state.from` preservation — post-login always lands on `/`, same as today.

## `app/(dashboard)/layout.tsx` (the whole file)
```tsx
'use client';
import { DataProvider } from '../../components/DataProvider';
import { DashboardShell } from '../../components/DashboardShell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DataProvider><DashboardShell>{children}</DashboardShell></DataProvider>;
}
```

## `AppSidebar.tsx` port rules
Delete the `activeTab` and `setActiveTab` props; keep `settingsSubTab` and `setSettingsSubTab` (same names/types, `SettingsSubTab` now from `../types`). Use `const pathname = usePathname()` and `const router = useRouter()`. `isActive` is a local helper comparing `pathname`. Nav items — same icons, labels, tooltips, badges and the whole footer (technician-status switch, user card, onboarding/logout buttons) copied verbatim:

| Label | `onClick` | `isActive` |
|---|---|---|
| Overview | `router.push('/')` | `pathname === '/'` |
| Dispatch Board | `router.push('/dispatch')` | `pathname === '/dispatch'` |
| SMS Inbox | `router.push('/sms')` | `pathname === '/sms'` |
| Missed Calls | `router.push('/missed-calls')` | `pathname === '/missed-calls'` |
| Customers | `router.push('/customers')` | `pathname === '/customers'` |
| Organization | `setSettingsSubTab('general'); router.push('/settings?tab=general')` | `pathname === '/settings' && settingsSubTab === 'general'` |
| Service Rates | `setSettingsSubTab('rates'); router.push('/settings?tab=rates')` | `pathname === '/settings' && settingsSubTab === 'rates'` **or `pathname === '/services'`** |
| AI Dispatcher | `setSettingsSubTab('ai_dispatcher'); router.push('/settings?tab=ai_dispatcher')` | `pathname === '/settings' && settingsSubTab === 'ai_dispatcher'` |
| + Book Manual Job | `onOpenNewBooking()` | — |

## `Header.tsx` port rules
Delete `activeTab`/`setActiveTab`/`setActiveTab` from props; keep `settingsSubTab`, `settings`, `unreadSmsCount`, `unconvertedCallsCount`, `onOpenNewBooking`, `neonConnected`, `neonLatency`, `user`, `onLogout`, `isDataLoading`, `onRefreshData`. `getTabTitle()` switches on `usePathname()` using the **exact existing strings**: `/` → `'Overview Dashboard'`, `/dispatch` → `'Dispatch Board & Schedule'`, `/sms` → `'SMS Autonomous Inbox'`, `/missed-calls` → `'Missed Call Recovery Pipeline'`, `/customers` → `'Customer Profiles'`, `/services` → `'Organization Settings · Service Rates'`, `/settings` → the existing `settingsSubTab` map (general → `'Organization Settings · Profile'`, rates → `'Organization Settings · Service Rates'`, ai_dispatcher → `'Organization Settings · AI Dispatcher'`, billing → `'Organization Settings · Plan & Billing'`), default `'Dashboard'`. `onRefreshData` in the shell = `showToast('Syncing live data from database...'); syncFromNeon(true);` (`App.tsx:641-644`).

## `app/(dashboard)/page.tsx` (placeholder, ~6 lines)
```tsx
export default function OverviewPage() {
  return <div className="text-sm text-neutral-500">Overview — lands in Sprint 4 Task 4.</div>;
}
```
Task 4 overwrites this file. It exists so `/` resolves and `next build` has a page for the layout.

## Verification
```bash
npx tsc --noEmit && npm test
npm --prefix apps/web run lint
npm --prefix apps/web run build      # required: confirms no useSearchParams-in-layout bailout
```
Runtime (root `npm run dev` :3000 + `npm --prefix apps/web run dev` :3001):
- `http://localhost:3001/` unauthenticated → bounces to `/auth` (no flash of shell, spinner then redirect).
- Log in via demo → `/` shows sidebar + header + the placeholder line; `page source` contains the Toast/Sidebar markup; the overview placeholder renders inside `<main>`.
- Sidebar: every one of the 8 nav items changes the URL and highlights correctly; Service Rates is highlighted on `/services` too (that route 404s until task 9 — the highlight is still observable via the URL).
- Header breadcrumb title changes per URL; "Sync Data" spins then re-syncs.
- "Book Job" in the Header and "+ Book Manual Job" in the sidebar open `NewBookingModal`; submitting posts `POST /api/bookings` and a job appears after Sync Data.
- Sign out → back to `/auth`; `curl -s http://localhost:3001/api/auth/me` returns `user: null`.
- Org switcher swaps workspace and toasts.
- Technician-status switch in the sidebar footer toggles.
- Root Vite app on :3000 still untouched.

## Non-goals
No overview/dispatch/sms/missed-calls/customers/services/settings pages beyond the `/` placeholder. No view components (tasks 4–9). No `'use client'` inside component files. No edits to task 1–2 files. No Vite removal.

## Where it fits
This is the freeze point. Tasks 4–9 may create files under `apps/web/app/(dashboard)/*/page.tsx` and their own `apps/web/components/*.tsx` copies, and must read everything else from `useData()`. The shell, provider, sidebar, header, and modals are read-only from here on.
