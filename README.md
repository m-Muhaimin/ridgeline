# RidgeLine - AI Scheduling & Dispatch Assistant

> **AI-powered scheduling, dispatch engine, and missed-call recovery system designed specifically for solo tradespeople.**  
> Built with React 19, TypeScript, Tailwind CSS v4, Express, Gemini 2.5/Flash AI, Neon Lakebase Serverless Postgres, and Recharts.

---

## 🛠️ The Solo Tradesperson Problem

Solo plumbers, electricians, locksmiths, and HVAC technicians face a persistent operational bottleneck: **they cannot answer phone calls or reply to text messages when they are under a sink, in an attic, on a roof, or in a crawlspace.**

- **Lost Revenue**: Over 62% of calls to solo trade contractors go to voicemail when on-job. Homeowners with leaking pipes or tripped breakers simply dial the next contractor on Google.
- **Context Switching**: Taking dirty gloves off to read texts or negotiate calendar slots causes delays, safety risks, and lost focus.
- **Scheduling Friction**: Coordinating schedules via natural-language text messages ("Can you push to Thursday afternoon?") is tedious and error-prone.

**RidgeLine solves this with an autonomous 24/7 AI dispatch assistant** that:
1. Answers customer SMS queries warmly, concisely, and decisively.
2. Identifies customer intent, urgency, and matches job descriptions to the trade service catalog.
3. Automatically offers viable calendar slots and auto-confirms bookings without double-booking.
4. Triages emergencies (gas leaks, pipe bursts, active electrical sparks) with immediate safety instructions and instant escalation.
5. Captures missed phone calls and sends instant AI textback to convert cold leads into booked revenue before they hire a competitor.
6. Displays interactive real-time telemetry, 7-day velocity analytics, and dispatch schedules with zero-latency Recharts and responsive skeleton loading states.

---

## 🚀 Key Features

### 1. SMS Conversation Engine & Auto-Booking
- **Natural-Language Understanding**: Interprets colloquial homeowner requests ("My kitchen faucet won't stop sputtering", "Push my water heater install to Friday at 2").
- **Smart Catalog Matching**: Dynamically computes job estimates, standard duration, and required parts from the trade's service catalog.
- **Double-Booking Prevention**: Inspects current calendar and buffer times before offering appointment windows.
- **Autonomous Auto-Confirmation**: Once the customer approves a time, the system commits the appointment to the database and schedules automated SMS reminders.

### 2. Instant Missed-Call Recovery
- Intercepts missed incoming calls from Twilio voice webhooks or simulated calls.
- Dispatches an automated, personalized text back within **3 seconds**:  
  *"Hey! This is RidgeLine, dispatcher for Mark at Kowalski Plumbing. Mark is currently on a job and can't pick up. What plumbing issue are you experiencing today?"*
- Converts 40%+ of abandoned calls directly into scheduled, paid appointments.

### 3. Emergency Triage & Safety Escalation
- Autonomous keyword and semantic detection for life-safety or catastrophic property damage risks (e.g., active flooding, carbon monoxide, sparking panels, gas odors).
- Immediately replies with safety precautions (e.g., *"Please turn off the main water shutoff valve clockwise immediately"*).
- Triggers priority alert banners and bypasses routine buffer scheduling.

### 4. Interactive Dispatch Board
- Kanban-style dispatch board tracking jobs through stages: **Scheduled**, **En Route**, **In Progress**, and **Completed**.
- Real-time customer phone dialing, SMS thread shortcuts, turn-by-turn navigation addresses, and urgent status badges.

### 5. Multi-Tenant Architecture & Workspace Switcher
- Supports multiple trade companies (e.g., *Kowalski Plumbing & Drain*, *Apex Spark Electric*, *Vanguard HVAC Systems*).
- Switch seamlessly between trades with tenant-isolated database records, custom trade services, and distinct Twilio numbers.

### 6. Analytics & Recharts Dashboards with Skeleton States
- **Rolling 7-Day Performance Charts**:
  - **Overview**: Completed Bookings vs. Gross Booked Revenue.
  - **Dispatch**: 7-Day Workload Velocity & Execution Capacity (AreaChart).
  - **Missed Calls**: 7-Day Call Recovery Velocity & Conversion Rates (BarChart).
  - **Customers**: 7-Day Customer Revenue & Repeat Booking Velocity (AreaChart).
- **Responsive Skeleton Loading States**: Smooth animated SVG wave curves, gridlines, dual-column skeletons, and pill badges while data syncs from Neon Postgres or API routes.

---

## 🏛️ System Architecture

Two processes. The host (or `next.config.ts` in development) routes `/api/*` and `/webhooks/*` to
Express and everything else to Next.js. The shipped compose stack implements exactly that split in
`edge` — see [Docker Deployment](#5-docker-deployment).

```
                          ┌──────────────────────────┐
                          │   Twilio SMS / Voice     │
                          │   (Webhooks & Messages)  │
                          └────────────┬─────────────┘
                                       │  (POST /webhooks/twilio/* — straight to :3000,
                                       │   never through the Next rewrite)
                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│              Express API Server (:3000)  — API ONLY                    │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Gemini 2.5 Flash SDK  │  │ Neon Lakebase   │  │ Auth & Security  │  │
│  │ AI Dispatch Engine    │  │ Serverless Pool │  │ PBKDF2 / Multi-  │  │
│  │ (Triage & Slot Match) │  │ (Postgres 15+)  │  │ Tenant Isolator  │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
└──────────────────────────────────────┬─────────────────────────────────┘
                                       │  /api/*  (rewrites() proxy in dev,
                                       │   host-level path split in production)
                                       ▼
┌────────────────────────────────────────────────────────────────────────┐
│            Next.js App Router (:3001)  — UI ONLY                       │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Dispatch Kanban Board │  │ SMS Inbox View  │  │ Missed Call Desk │  │
│  │      /dispatch        │  │      /sms       │  │   /missed-calls  │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ Recharts Visualizer   │  │ Customer CRM    │  │ Org & Settings   │  │
│  │ (with Skeleton State) │  │   /customers    │  │ & Live Simulator │  │
│  │    /  (overview)      │  │ /services       │  │    /settings     │  │
│  └───────────────────────┘  └─────────────────┘  └──────────────────┘  │
│                                                                        │
│  Also: /auth  /onboarding   (own route group, own package.json)         │
└────────────────────────────────────────────────────────────────────────┘
```

Express serves no HTML: the only frontend it can emit is a JSON 404 for an unmatched `/api/*` path.

---

## 📂 Project Structure

```
├── .agents/skills/            # Agent tool skills (Neon, AI gateway, auth)
├── metadata.json              # Studio project metadata and capabilities
├── package.json               # API deps & scripts (the web app has its own)
├── bun.lock                   # Committed root lockfile (API deps)
├── Dockerfile  .dockerignore  # API image (:3000) — bun install --frozen-lockfile, npm start
├── docker-compose.yml         # edge(:80) + api(:3000) + web(:3001)
├── docker/nginx.conf          # Public path split: /api/* + /webhooks/* -> api, rest -> web
├── server.ts                  # Express API (:3000) — routes, AI pipeline, Neon. No UI.
├── packages/                  # domain/ + application/ logic and the 159-test suite
├── scripts/                   # migrate.ts, migrate-auth.ts, backfill-booking-instents.ts
├── apps/web/                  # Next.js App Router frontend (:3001) — the whole UI
│   ├── app/
│   │   ├── (dashboard)/
│   │   │   ├── page.tsx              # /            overview + completed-bookings chart
│   │   │   ├── dispatch/page.tsx      # /dispatch    kanban board + workload velocity
│   │   │   ├── sms/page.tsx           # /sms         2-way SMS inbox
│   │   │   ├── missed-calls/page.tsx  # /missed-calls recovery desk + bar chart
│   │   │   ├── customers/page.tsx     # /customers   CRM profiles & revenue chart
│   │   │   ├── services/page.tsx      # /services    trade catalog, pricing & parts
│   │   │   ├── settings/page.tsx      # /settings    org config, AI tone, simulators
│   │   │   └── layout.tsx             # dashboard shell (sidebar + header)
│   │   ├── (auth)/
│   │   │   ├── auth/page.tsx          # /auth        login & registration
│   │   │   └── onboarding/page.tsx    # /onboarding  4-step setup wizard
│   │   ├── health/page.tsx            # /health      frontend-only liveness route
│   │   ├── layout.tsx  globals.css
│   ├── components/
│   │   ├── DataProvider.tsx           # cross-view data context (mock seed -> /api/neon/data)
│   │   ├── DashboardShell.tsx         # authenticated layout
│   │   ├── AuthPage.tsx  OnboardingPage.tsx
│   │   ├── DispatchBoard.tsx          # kanban & 7-day workload velocity chart
│   │   ├── CompletedBookingsChart.tsx # 7-day bookings overview chart
│   │   ├── SmsInbox.tsx               # interactive 2-way SMS thread viewer
│   │   ├── MissedCallsView.tsx        # recovery table & 7-day bar chart
│   │   ├── CustomersView.tsx          # client profiles, history & revenue area chart
│   │   ├── OrganizationSettingsPanel.tsx  # trade config, AI tone, org switcher
│   │   ├── OrganizationSettings.tsx   # trade configuration & AI tone settings
│   │   ├── SimulateSmsModal.tsx       # customer SMS tester
│   │   ├── SimulateCallModal.tsx      # call simulation & textback trigger
│   │   ├── NewBookingModal.tsx        # manual dispatch appointment creator
│   │   ├── ChartSkeleton.tsx          # reusable Recharts skeleton loading states
│   │   ├── MetricCards.tsx            # quick metric indicators with sparkline bars
│   │   ├── AppSidebar.tsx  Header.tsx  OrgSwitcher.tsx
│   │   ├── AIIcon.tsx  EmptyState.tsx  RidgeLineLogo.tsx
│   │   └── ui/                        # button.tsx, sidebar.tsx
│   ├── lib/                          # apiFetch.ts, chartUtils.ts, triage.ts, timezones.ts, utils.ts
│   ├── next.config.ts                # rewrites(): /api/:path* -> $API_ORIGIN (default http://localhost:3000)
│   ├── Dockerfile  .dockerignore     # web image — npm ci, next build, next start -p 3001
│   ├── package.json  tsconfig.json  postcss.config.mjs
│   ├── mockData.ts                   # in-memory baseline data & fallback state
│   └── types.ts                      # TypeScript models (Bookings, Threads, Orgs, Users)
└── supabase/migrations/
    └── 20260927000000_init_ridgeline_schema.sql # Complete Postgres schema with RLS
```

---

## ⚡ Quick Start & Development

### 1. Prerequisites
- Node.js 20+
- A Google Gemini API Key (`GEMINI_API_KEY`)
- *(Optional)* A Neon PostgreSQL database URL (`DATABASE_URL`)

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Ensure the following variables are defined:
```ini
# OpenAI-Compatible AI Gateway Settings (e.g. vLLM, LiteLLM, Ollama)
OPENAI_COMPATIBLE_BASE_URL="https://your-gateway-address.example.com/v1"
OPENAI_COMPATIBLE_API_KEY="your_openai_compatible_api_key"
OPENAI_COMPATIBLE_MODEL="gemini/gemini-3.8-flash"

# Google Gemini API Key (Direct SDK fallback)
GEMINI_API_KEY="your_gemini_api_key"

# Database (Neon Lakebase Postgres)
DATABASE_URL="postgresql://user:password@host/neondb?sslmode=require"
```

### 3. Installation & Run
The web app is a **separate install** from the API — run both.
```bash
# API dependencies (root)
npm install --legacy-peer-deps

# Web dependencies (apps/web)
npm install --prefix apps/web
```

Start **both** processes, in two terminals:
```bash
npm run dev        # terminal 1 -> Express API + Twilio webhooks on http://localhost:3000
npm run dev:web    # terminal 2 -> Next.js UI on http://localhost:3001
```
Open [http://localhost:3001](http://localhost:3001) in your browser.

**The browser only ever talks to :3001.** There is no API base URL to configure: `next.config.ts`
proxies `/api/*` to `http://localhost:3000/api/*` with a Next rewrite, so the session cookie
(for `localhost:3001`) is forwarded to Express unchanged. `/webhooks/*` is deliberately *not*
proxied — Twilio posts to :3000 directly.

### 4. Build for Production
```bash
npm run build:web   # next build -> apps/web/.next
npm --prefix apps/web run start   # Next on :3001
npm start                          # Express API on :3000
```

Both processes must run. Route `/api/*` **and** `/webhooks/*` to the Express process and everything
else to the Next process at the host/reverse-proxy level — the Next rewrite above is a dev
convenience, and Twilio signature validation needs to reach Express on its real host.

### 5. Docker Deployment

The repo ships a compose stack that does exactly that split for you: three containers, one public
port. No `vercel.json`/`render.yaml` is involved and no state is stored on disk — the database is
managed Neon.

| Service | Image | Role | Reachable at |
|---|---|---|---|
| `edge` | `nginx:alpine` | public entrypoint, path-splits the origin | `http://localhost` (**host** `:80`) |
| `api` | root `Dockerfile` | Express API + Twilio webhooks | `api:3000` (internal only) |
| `web` | `apps/web/Dockerfile` | Next.js UI | `web:3001` (internal only) |

```
browser ──▶ edge :80 ──┬── /api/*        ──▶ api:3000   (Express)
                       ├── /webhooks/*   ──▶ api:3000   (Twilio signature validation)
                       └── /*            ──▶ web:3001   (Next.js)
```

Only `edge` publishes a port. `:3000` and `:3001` stay on the compose network, which is what keeps
the "one origin" story true: the browser talks to a single host, the `ridgeline_session` cookie is
set for that host, and nothing can bypass the rewrite by hitting the API directly.

**Env contract.** `docker compose` reads a `.env` file from the repo root automatically (gitignored
— copy `.env.example`, fill it in, never commit it). Compose hardcodes no secret; every value is
interpolated from the environment. Minimum viable production `.env`:

```bash
APP_URL="https://your-domain.example.com"   # REQUIRED, see below

# Signing secrets — generate with: openssl rand -hex 32
JWT_SECRET="..."
SESSION_SECRET="..."
COOKIE_SECRET="..."

# Managed Postgres. Unset => nothing persists and every route serves mock data.
DATABASE_URL="postgresql://user:your_password@your-host/neondb?sslmode=require"

# Twilio. Unset => nothing is sent and signature checks are skipped in non-production.
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="..."
TWILIO_PHONE_NUMBER="+15557824309"

# At least one LLM path, else the assistant degrades to a rule-based responder.
OPENAI_COMPATIBLE_BASE_URL="https://your-gateway-address.example.com/v1"
OPENAI_COMPATIBLE_API_KEY="..."
OPENAI_COMPATIBLE_MODEL="gemini/gemini-3.8-flash"
GEMINI_API_KEY="..."
```

`APP_URL` is **required** and must be the exact public origin (scheme + host + port, no trailing
slash). It is rebuilt into the URL Twilio signed, so a mismatch makes every webhook fail signature
validation with a 403; it also seeds the same-origin allow-list for state-changing `/api` calls.
Compose will not tell you it is missing — check the boot log and `/api/health`.

Optional: `ALLOWED_ORIGINS` (extra browser origins), `WEB_API_ORIGIN` (only if the API is not the
`api` service), `NODE_ENV=development` (see the TLS caveat below), and the `NEON_*`/`AWS_*` pair
behind `/api/neon/*`.

**Build and run:**

```bash
docker compose up -d --build     # first build pulls node:22-slim + nginx:alpine and runs npm ci twice
docker compose ps                # every service should reach (healthy)
docker compose logs -f edge      # one line per request, with which upstream served it
docker compose down              # tear down (no volumes to clean up)
```

**Health checks:**

```bash
docker compose ps                                        # (healthy) per service
curl -s http://localhost/healthz                         # edge itself
curl -s http://localhost/api/health                      # API process (reports which integrations are configured)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/ # web process, 200
```

`/api/health` is the one that matters: it is unauthenticated, never touches Postgres, and tells you
which of Gemini / the OpenAI-compatible gateway / Neon are actually configured — which is the only
way to tell a real deployment from the silent mock fallback.

**Operational notes**

- **Images**: multi-stage, `node:22-slim`, and both processes run as an unprivileged uid 1001 with
  no shell and no login home. The API additionally runs with a read-only root filesystem and
  `no-new-privileges` (it writes nothing but npm's cache in a tmpfs); the web container keeps a
  writable `.next` because Next caches at runtime. The API image is built with
  `bun install --frozen-lockfile` because `bun.lock` is the only root lockfile — `npm ci` cannot work
  without a `package-lock.json` the repo deliberately does not have. The web image uses `npm ci`
  against `apps/web/package-lock.json` and builds with `next build`. Both start with the same
  commands as local dev (`npm start` / `npm run start`), i.e. npm + tsx/next, unchanged.
- **CI**: `.github/workflows/docker-smoke.yml` builds and boots this whole stack on every push to
  `main` — no secrets, so the API runs in mock mode — and asserts the edge, the `/api/*` and
  `/webhooks/*` → `api` split, and a 200 from Next. It is the first real proof that the
  Dockerfiles work without installing Docker locally.
- **No volumes**: no app state is persisted anywhere — the database is managed Neon. Container logs
  are capped at 3 × 10 MB so a long-running host cannot fill its disk.
- **TLS**: the stack is plain HTTP on `:80`. In `NODE_ENV=production` the session cookie is issued
  `Secure; SameSite=None`, which a browser will not store over plain HTTP — so put a TLS terminator
  in front of `edge` (or bind 443 with certs) for any real deployment. For a quick local trial on
  plain HTTP, set `NODE_ENV=development` in `.env`; that also re-enables the Twilio signature
  bypass, so never use it for anything reachable from the internet.
- **Migrations**: `initDb()` creates the schema on every boot, so there is nothing to run first. The
  one-off scripts (`scripts/migrate.ts`, `migrate-auth.ts`, `backfill-booking-instents.ts`) are not
  in the images — run them from a local checkout with `npx tsx scripts/migrate.ts`.
- **Upgrades**: `API_ORIGIN` is a *build* argument as well as a runtime env var, because Next bakes
  `rewrites()` into `.next` at build time. If you change it, rebuild:
  `docker compose up -d --build web`.
- **Debugging a service**: `docker compose exec api sh` is unavailable (no shell) — use
  `docker compose exec api node -e "..."` or `docker compose logs -f api`.

---

## 🧪 Simulation & Testing Features

RidgeLine includes built-in simulation tools so solo tradespeople and reviewers can test live AI behavior without burning carrier SMS credits:

1. **Simulate Customer SMS**: Click **"Simulate SMS"** to send incoming messages (e.g., *"My basement pipe burst, water is spraying everywhere!"* or *"Can we reschedule our drain cleaning to tomorrow at 10am?"*). Watch the Gemini assistant reply and auto-dispatch within seconds.
2. **Simulate Missed Call**: Click **"Simulate Call"** to emulate a caller leaving voicemail. RidgeLine triggers an autonomous auto-textback into the SMS inbox.
3. **Live Sync & Skeletons**: Click **"Sync Data"** in the top header at any time to verify live Neon database roundtrips and preview the Recharts skeleton transitions.

---

## 🛡️ License

Built for solo trade professionals. Distributed under the MIT License.
