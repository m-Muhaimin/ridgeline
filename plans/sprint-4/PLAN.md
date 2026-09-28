# Sprint 4 - Next.js App Router (plan)

**Exit condition (IMPLEMENTATION.md:1096):** Next.js owns the web application while Express remains the backend API.

**Checklist (IMPLEMENTATION.md:1082-1094):** Create apps/web; Configure Next.js App Router; Migrate authentication UI; dashboard shell; overview; dispatch; SMS; customers; services; settings; Remove Vite frontend.

---

## 1. Current state (verified this session)

- **One process** serves UI + API: Express on hardcoded PORT = 3000 (server.ts:21); dev mounts Vite middlewareMode (server.ts:2822-2827), prod serves dist/ + app.get('*') SPA fallback (2829-2832); unmatched /api/* -> JSON 404 (2809-2819).
- **Auth:** httpOnly cookie `ridgeline_session` (server.ts:62); flags httpOnly, secure + sameSite:'none' only in production, sameSite:'lax' in dev (284-296); cookie-only since Sprint 3; client session check = GET /api/auth/me (App.tsx:151).
- **Origin guard (Sprint 3):** app.use('/api', ...) cross-origin check (server.ts:175-212) - Origin/Referer host must match Host or ALLOWED_ORIGINS/APP_URL; /webhooks/* exempt (mounted on /api only).
- **Webhooks:** /webhooks/twilio/{sms,voice,voice-status} (2234/2375/2399), twilioFormParser + verifyTwilioSignature (139-160; base = APP_URL || req.protocol://req.get('host') at 154).
- **Frontend surface (src/):** App.tsx 1032 lines = orchestrator. State at 74-92 (7 collections + activeTab + settingsSubTab + user). One-shot data load syncFromNeon -> GET /api/neon/data + /api/neon/status (95-145). Mount effect: sync + /api/auth/me (147-167). Mutations: /api/sms/process (258), /api/availability (433 + 47 NewBookingModal), /api/bookings/{id} GET (450), POST /api/bookings (484, 1004), /api/organizations (930), /api/services (964), /api/organizations/switch (213 raw fetch), /api/auth/logout (181 raw fetch). Views: overview 651-855, dispatch 857-872, sms 874-891, missed_calls 893-908, customers 910-917, settings+services 919-985 (services = SettingsView with activeSubTab 'rates'). ProtectedRoute 47-70.
- **Pages:** AuthPage.tsx (291: login/register tabs + one-click demo login, ?mode= query), OnboardingPage.tsx (569: 4-step wizard -> POST /api/auth/complete-onboarding).
- **Components (20):** ui/sidebar.tsx, ui/button.tsx, AppSidebar, Header, MetricCards, CompletedBookingsChart, ChartSkeleton, DispatchBoard, SmsInbox, SimulateSmsModal, MissedCallsView, SimulateCallModal, CustomersView, ServiceCatalog, SettingsView, OrganizationSettings (+ SettingsSubTab), NewBookingModal, OrgSwitcher, RidgeLineLogo, AIIcon, EmptyState. Only NewBookingModal + OnboardingWizard fetch directly; everything else prop-driven from App.tsx.
- **Lib:** apiFetch.ts (relative paths, credentials include, JSON guard), utils.ts, timezones.ts, chartUtils.ts. types.ts = only client-side contract. mockData.ts = seed data.
- **Theme:** Tailwind v4 via @import "tailwindcss" + @theme fonts (index.css: Bricolage Grotesque head / IBM Plex Sans body / IBM Plex Mono; Google Fonts link in index.html:12-14). No shadcn config; components are shadcn-style hand-rolled (@base-ui/react + radix slot + cva + tailwind-merge).
- **Toolchain:** root package.json - React 19, Vite 8, react-router 7, recharts 3, motion, lucide; tsc --noEmit = lint; node --import tsx --test = tests (159 pass); npm --legacy-peer-deps required (esbuild@^0.25.0 pin); bun.lock committed. tsconfig: no include/files -> typechecks whole repo together; types ["vite/client"].

---

## 2. Chosen architecture

### 2.1 Dev topology - Next proxies /api to Express
- Express stays the API on :3000 (hardcoded, unchanged). Next dev on :3001.
- next.config rewrites(): /api/:path* -> http://localhost:3000/api/:path*. Webhook paths are NOT proxied (two-process dev receives no Twilio traffic; production routing below keeps them off Next entirely).
- **Cookie flow:** cookies are per-host, not per-port - the browser talks only to :3001; Set-Cookie from Express responses flows back through the rewrite; the browser sends `ridgeline_session` to :3001 on every request (host localhost), Next forwards it in the proxy request. Same-site, so sameSite:'lax' dev cookie works.
- **Origin guard fix (required, small):** proxied requests arrive at Express with Host: localhost:3000 but browser Origin: http://localhost:3001 -> isAllowedOrigin would reject. Fix: in buildAllowedOrigins (server.ts ~175-212), seed the dev allowlist with http://localhost:3001 (alongside the existing localhost:3000 default) when NODE_ENV !== 'production'. Production stays strict env-driven (ALLOWED_ORIGINS/APP_URL).
- No CORS anywhere - everything stays same-origin from the browser's perspective.

### 2.2 Production topology - host-level path split, Next = pure UI
- Two processes: next start (:3001) + Express (:3000). Host reverse proxy (caddy/nginx/fly, chosen at Sprint 7 deployment):
  - /api/* and /webhooks/* -> Express directly (one public origin; Origin==Host so the guard passes trivially; webhook signature verification untouched - Twilio signs the public URL, Express validates with APP_URL).
  - everything else -> Next.
- Cookie flags already production-correct (Secure + SameSite=None at server.ts:285-286).
- Rationale: Express serving .next/standalone adds static/middleware complexity and cedes "Next owns the web app"; Next proxying in prod puts webhooks behind an extra hop for zero benefit.

### 2.3 Route model - the seven views become real URLs
- `/` -> overview (dashboard home), /dispatch, /sms, /missed-calls, /customers, /services, /settings (?tab=general|ai_dispatcher|rates, default general), /auth, /onboarding.
- activeTab state dies - pathname is the tab (Header title + sidebar active derive from usePathname). settingsSubTab becomes search-param-driven state in SettingsView.
- apps/web file layout:
  - app/layout.tsx - root: fonts + metadata (from index.html), Tailwind import.
  - app/(auth)/auth/page.tsx + app/(auth)/onboarding/page.tsx - client pages (ported Auth/Onboarding components).
  - app/(dashboard)/layout.tsx - client shell: session check (/api/auth/me), DataProvider (one /api/neon/data + /api/neon/status fetch - faithful port of syncFromNeon), sidebar/header/toast/org-switcher.
  - app/(dashboard)/page.tsx + 6 sibling page.tsx files - client components consuming the provider; "use client" at the shell boundary.
- **Data strategy - faithful client-port first.** Views are interactive (chat, board, modals); moving them to Server Components while keeping the single /api/neon/data contract has no RSC benefit and high churn. RSC-ification becomes meaningful in Sprint 5 (realtime) when per-domain endpoints exist. Exit condition is met without it.

### 2.4 Repo layout - apps/web self-contained, no workspaces
- apps/web gets its own package.json, tsconfig.json (Next default), next.config.ts, postcss/tailwind config, node_modules. No npm workspaces, no bun.lock restructuring (root lockfile untouched until Vite removal).
- Shared client assets are copied into apps/web (types.ts, lib/{apiFetch,utils,timezones,chartUtils}, mockData as needed); root src/ frozen until Task 10. Duplication is the strangler mechanism - removed when Vite dies.
- Root tsc --noEmit unaffected (whole-repo typecheck); apps/web lints itself (tsc --noEmit inside apps/web). Root npm run lint stays green at every task.
- Install: npm install --legacy-peer-deps inside apps/web (repo convention).
- Next version: latest stable at install time (verify React 19 + Tailwind 4 compat; pin the resolved major explicitly in apps/web package.json).

### 2.5 Server.ts changes across the sprint (contained, additive)
1. Dev allowlist seed for http://localhost:3001 in buildAllowedOrigins (Task 1).
2. Task 10: strip Vite/dev branch + dist/ static + SPA app.get('*') from startServer; delete src/, index.html, vite.config.ts, root frontend deps/scripts (build, preview, clean); update AGENTS.md + README (topology, commands dev:web/start:web, ports, tests); root npm run dev = API only.

---

## 3. Task list (one implementer dispatch each; gate after each)

| # | Task | Deliverable | Gate |
|---|------|-------------|------|
| 1 | Create apps/web + configure Next App Router | Own package.json/tsconfig/next.config (rewrites /api -> :3000), Tailwind v4 + fonts, metadata, health page fetching /api/neon/status THROUGH the proxy; server.ts dev-origin allowlist extension | apps/web tsc green; root tsc green; backend 159 tests; dev servers + browser check of health page |
| 2 | Port shared lib + auth UI | apps/web/lib/*, types.ts, mockData; /auth + /onboarding pages (ported) + one-click demo login | lint; browser: login/register/demo hit Express through proxy |
| 3 | Dashboard shell | (dashboard)/layout.tsx client shell: session check, DataProvider (neon/data + status), ported sidebar/header/logo/toast/org switcher; route guard -> /auth | lint; browser: shell renders, data populated, sidebar nav switches routes |
| 4 | Overview | / page: MetricCards, charts, NewBookingModal wiring, quick actions | lint; browser |
| 5 | Dispatch | /dispatch page: DispatchBoard | lint; browser |
| 6 | SMS | /sms page: SmsInbox + SimulateSmsModal (/api/sms/process) | lint; browser: simulate sends and thread updates |
| 7 | Missed calls | /missed-calls: MissedCallsView + SimulateCallModal | lint; browser |
| 8 | Customers | /customers: CustomersView | lint; browser |
| 9 | Services + Settings | /services (SettingsView rates tab), /settings?tab= (OrganizationSettings subtabs) | lint; browser |
| 10 | Remove Vite frontend | delete src/, index.html, vite.config, root frontend deps/scripts, strip startServer serving; AGENTS.md + README rewrite | root tsc green; backend 159; next build green; both apps run |

Tasks 4-9 are file-disjoint (one page each) and can be dispatched in PARALLEL WAVES after Task 3 lands - they share the shell + provider contract from Tasks 2-3.

## 4. Verification
- Per task: npm --prefix apps/web run lint + root npx tsc --noEmit + node --import tsx --test "packages/**/__tests__/*.test.ts" (159 baseline stays green) + next build at tasks 1, 3, 10.
- Browser gates on the running dev servers (:3001 UI, :3000 API): login, data render, each view, mutations.
- Final: npm run dev (Express API-only) + npm --prefix apps/web run dev (UI) together; verify cookie auth end-to-end through the proxy.

## 5. Risks
- Next rewrites + Set-Cookie/header forwarding: verify early (Task 1 health page; Task 2 login - browser gate proves the cookie round-trip).
- Next version x React 19 x Tailwind 4: pin after install; if latest stable has peer friction, fall back one major.
- tsc whole-repo coupling: apps/web self-contained tsconfig isolates it; root tsconfig untouched until Task 10.
- npm ERESOLVE: apps/web install uses --legacy-peer-deps (repo convention); root tree untouched until Task 10 (which removes the esbuild pin conflict source entirely).
- Duplication drift (src/ vs apps/web/): bounded - apps/web is the source of truth going forward; src/ frozen until deletion.

## 6. Open decisions (user)
1. Full-sprint strangler (all 10 tasks now) vs partial (scaffold + auth + shell first)?
2. Faithful client-port data strategy now (RSC later in Sprint 5) vs force RSC now? (rec: client-port)
3. Self-contained apps/web with copied libs (no workspaces) vs npm workspaces monorepo? (rec: self-contained)
4. URL scheme: / = overview + ?tab= for settings subtabs (rec) vs /overview + sub-paths?
5. Next version: latest stable vs conservative prior major? (rec: latest stable, pinned)
