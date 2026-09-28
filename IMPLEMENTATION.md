# RidgeLine Implementation Plan

## Objective

Evolve RidgeLine from its current AI scheduling prototype into a production-grade AI scheduling and dispatch platform without performing a risky full rewrite.

The preferred strategy is **domain-first, correctness-first, incremental migration**:

```text
Scheduling Truth Engine
        ↓
Domain / Application Service Extraction
        ↓
Next.js App Router Migration
        ↓
Realtime + Reliable UX
        ↓
Production Hardening
        ↓
Customer Pilot
```

The current Express API, PostgreSQL schema, Twilio integration, AI provider abstraction, and existing React UI should be preserved where practical.

---

# 0. Non-Negotiable Architecture Principles

Before implementation, establish these rules:

1. **The LLM never owns business truth.**
   - AI interprets customer intent.
   - Deterministic domain services decide what can actually happen.

2. **The database is authoritative.**
   - Availability, bookings, customers, services, settings, and conversation state come from the server/database.
   - The browser must not provide authoritative scheduling context.

3. **Every booking operation is transactional.**
   - No double-booking.
   - No booking confirmation without an actual database commit.

4. **All tenant-scoped database access is tenant-aware.**
   - RLS remains the final security boundary.
   - Webhooks and system operations must also establish tenant context.

5. **One domain implementation.**
   - Do not maintain separate booking/AI/fallback business logic in React and Express.

6. **External webhooks are idempotent.**
   - Twilio retries must never create duplicate messages, bookings, or missed-call records.

7. **Safety policies are deterministic.**
   - Emergency handling must not depend solely on LLM behavior.

---

# Phase 1 — Build the Scheduling Truth Engine

## Goal

Make RidgeLine capable of answering one authoritative question:

> “Can this appointment actually be booked?”

This is the highest-priority phase.

## 1.1 Introduce real temporal booking fields

Move away from:

```text
scheduled_date
time_slot VARCHAR
```

toward:

```text
scheduled_start TIMESTAMPTZ
scheduled_end   TIMESTAMPTZ
timezone
```

Retain the existing fields temporarily if needed for migration compatibility.

### Requirements

- Store UTC timestamps.
- Preserve organization/customer timezone.
- Normalize all comparisons to timestamps.
- Support DST correctly.

---

## 1.2 Create scheduling domain services

Create:

```text
packages/domain/scheduling/
    availability.ts
    slot-generator.ts
    conflict.ts
    booking-policy.ts
    timezone.ts
```

Core APIs:

```ts
getAvailability()
findAvailableSlots()
checkConflict()
validateBooking()
reserveSlot()
rescheduleBooking()
cancelBooking()
```

The scheduling engine must understand:

- business hours
- weekends
- service duration
- appointment buffers
- existing bookings
- technician/resource availability
- timezone
- cancellation state
- rescheduling
- emergency policy

---

## 1.3 Enforce database-level conflict protection

Do not rely only on JavaScript checks.

Use PostgreSQL transactional protection.

Preferred model:

```text
booking request
    ↓
BEGIN
    ↓
lock/check availability
    ↓
insert booking
    ↓
COMMIT
```

Where practical, use PostgreSQL range/exclusion constraints to prevent overlapping active appointments.

The database should make impossible states difficult or impossible.

---

## 1.4 Remove hardcoded fallback slots

> **Status: done.** No business path invents a time. The rule-based responder,
> the SMS pipeline, the in-memory branches, the frontend simulator and the
> manual booking form all resolve openings through the scheduling engine
> (`proposeAvailableSlots` / `GET /api/availability`). A time is written only
> when the customer stated one *and* it passed the conflict check. `mockData.ts`
> still contains demo slots as UI seed data, which is not booking logic.

Remove assumptions such as:

```text
Tomorrow 09:00–11:00
Today 13:30–15:30
```

from fallback business logic.

Fallback logic should query:

```text
organization settings
service duration
business hours
existing bookings
```

and generate real slots.

---

## 1.5 Separate proposal from confirmation

> **Status: done for the scheduling path.** The assistant returns
> `requestedSlot` — a time the customer *stated*, never one it chose — and the
> system resolves that against live availability before writing. With no
> resolvable interval it offers verified openings and waits. The explicit
> Policy Engine below is still Phase 2.4; until then intent classification
> lives in the responder.

The AI should produce:

```json
{
  "action": "propose_slot",
  "serviceId": "...",
  "requestedWindow": {}
}
```

The system should then:

```text
AI proposal
    ↓
Policy Engine
    ↓
Scheduling Engine
    ↓
available slot
    ↓
customer confirmation
    ↓
transactional booking
```

Never allow:

```text
LLM → INSERT booking
```

---

# Phase 2 — Extract the Domain/Application Layer

## Goal

Reduce the responsibility of `server.ts` and remove business logic duplication.

Target architecture:

```text
HTTP / Twilio
      ↓
Application Services
      ↓
Domain Services
      ↓
Repositories
      ↓
PostgreSQL
```

## 2.1 Create domain packages

Recommended structure:

```text
packages/
  domain/
    scheduling/
    bookings/
    conversations/
    safety/
    organizations/
    customers/

  ai/
    providers/
    prompts/
    schemas/
    agent/

  database/
    repositories/
    migrations/

  integrations/
    twilio/

  shared/
    types/
    validation/
```

---

## 2.2 Extract booking service

Create:

```text
booking-service.ts
```

Responsibilities:

- create booking
- validate booking
- reschedule
- cancel
- assign resource
- emit booking events

Routes should call this service rather than directly inserting into PostgreSQL.

---

## 2.3 Extract conversation service

Create:

```text
conversation-service.ts
```

Responsibilities:

- load thread
- load customer
- load recent messages
- construct authoritative AI context
- run AI
- apply policy
- persist message
- trigger booking actions

The browser should send something close to:

```json
{
  "threadId": "...",
  "message": "Tomorrow afternoon works"
}
```

The server loads everything else.

---

## 2.4 Create an explicit policy engine

Create:

```text
packages/domain/conversations/policy-engine.ts
```

It should decide:

```text
Can the AI:
- answer?
- quote?
- propose a slot?
- confirm a booking?
- reschedule?
- cancel?
- escalate to human?
```

Example:

```text
AI says:
"Customer wants to book"

Policy Engine:
  service identified? yes
  address known? yes
  requested slot? yes
  auto-confirm enabled? yes
  slot actually available? yes

→ allow booking
```

---

# Phase 3 — Harden Multi-Tenancy and Webhooks

This phase should happen before exposing the system broadly.

## 3.1 Eliminate unsafe tenant fallback

Remove behavior equivalent to:

```sql
ORDER BY created_at
LIMIT 1
```

when resolving a Twilio number.

Unknown Twilio numbers must fail safely.

```text
unknown number
    ↓
configuration error
    ↓
log
    ↓
reject
```

Never route to an arbitrary organization.

---

## 3.2 Make RLS universal

All tenant-scoped operations should execute with tenant context.

Preferred:

```text
request
 ↓
organization
 ↓
tenant DB transaction
 ↓
RLS
```

Do not maintain two models where normal API calls use RLS but webhook code relies primarily on manual `organization_id` filters.

---

## 3.3 Add webhook idempotency

Use provider identifiers:

```text
Twilio MessageSid
Twilio CallSid
```

as idempotency keys.

Repeated webhook:

```text
already processed
    ↓
return previous result
```

Never execute the booking workflow twice.

---

## 3.4 Make webhook processing resilient

Introduce:

```text
received
processing
processed
failed
retryable
```

states where appropriate.

Keep external webhook handling thin and move business logic into application services.

---

# Phase 4 — Emergency and Safety Engine

## Goal

Make emergency handling deterministic and auditable.

Create:

```text
packages/domain/safety/
    emergency-classifier.ts
    safety-policy.ts
    escalation.ts
```

Classify cases such as:

```text
water emergency
electrical emergency
gas / CO
HVAC no-heat
sewage
unknown hazardous situation
```

The LLM may help classify/extract context, but the final safety policy should be deterministic.

For example:

```text
electrical smoke
    ↓
electrical emergency policy
    ↓
approved response
    ↓
priority handling
    ↓
human escalation where required
```

Do not use a generic water-shutoff fallback for unrelated emergency types.

---

# Phase 5 — Next.js App Router Migration

## Goal

Move the frontend to a modern Next.js App Router architecture without rewriting the backend.

## Important

Do **not** simultaneously rewrite:

- Express
- PostgreSQL
- AI architecture
- authentication
- integrations

The first migration should be:

```text
Vite React
      ↓
Next.js App Router

Existing Express API remains.
```

---

## 5.1 Recommended application structure

```text
apps/
  web/
    app/
      (marketing)/
        page.tsx
        pricing/
        features/

      (auth)/
        login/
        signup/

      (dashboard)/
        layout.tsx
        page.tsx
        dispatch/
        sms/
        missed-calls/
        customers/
        services/
        settings/

    components/
    lib/
    hooks/
```

---

## 5.2 Server Components for data-heavy pages

Use Server Components for:

- dashboard initial data
- customers
- services
- settings
- booking lists
- analytics

Use Client Components for:

- drag/drop dispatch
- filters
- interactive SMS inbox
- modal workflows
- optimistic UI
- realtime updates

Example:

```text
Dispatch page
    │
    ├── Server Component
    │      └── fetch today's schedule
    │
    └── Client Component
           ├── drag/drop
           ├── status changes
           └── realtime updates
```

---

## 5.3 Keep Express as the domain API

Initially:

```text
Next.js
   ↓
Express API
   ↓
Domain Services
   ↓
PostgreSQL
```

Do not move everything into Next.js route handlers immediately.

This gives a safe migration path.

---

## 5.4 Consolidate frontend API access

Create:

```text
apps/web/lib/api/
    auth.ts
    bookings.ts
    customers.ts
    conversations.ts
    services.ts
```

Avoid raw `fetch()` calls scattered throughout components.

---

# Phase 6 — Authentication and Authorization Hardening

## 6.1 Prefer HTTP-only sessions

Avoid exposing long-lived JWTs to JavaScript/localStorage unless there is a specific requirement.

Preferred:

```text
Browser
  ↓
Secure HTTP-only cookie
  ↓
server
  ↓
session
```

---

## 6.2 Add explicit authorization

Define permissions such as:

```text
owner
admin
dispatcher
technician
viewer
```

Then enforce them server-side.

Example:

```text
dispatcher
  → manage bookings

technician
  → update assigned job status

viewer
  → read-only
```

Do not rely on hiding buttons in the frontend.

---

## 6.3 Add CSRF/origin protection

For cookie-authenticated state-changing operations:

- strict allowed origins
- Origin/Referer validation
- CSRF protection where appropriate

---

# Phase 7 — Realtime and Operational UX

Once the domain layer is authoritative, improve realtime behavior.

## Events

Introduce domain events:

```text
booking.created
booking.updated
booking.cancelled

message.received
message.sent

missed_call.received
missed_call.converted

job.status_changed
```

Then use them for:

```text
dispatch board
SMS inbox
notifications
analytics
audit log
```

---

## Realtime architecture

```text
Domain event
     ↓
PostgreSQL/event layer
     ↓
Realtime transport
     ↓
Next.js client
```

The UI should never assume an operation succeeded until the server confirms it.

---

# Phase 8 — Observability and Auditability

Add structured logging.

Every important operation should include:

```text
request_id
organization_id
user_id
customer_id
thread_id
booking_id
provider_event_id
```

Track:

```text
AI latency
AI provider failures
fallback usage
booking conflicts
booking success/failure
Twilio failures
webhook retries
LLM token usage
```

---

## AI decision logging

Do not store unnecessary sensitive data, but retain enough structured information to answer:

> Why did RidgeLine take this action?

Example:

```json
{
  "intent": "book",
  "action": "propose_slot",
  "serviceId": "...",
  "slot": "...",
  "policyDecision": "allowed",
  "availabilityDecision": "available"
}
```

This is critical for debugging autonomous behavior.

---

# Phase 9 — Testing

Before autonomous customer booking, establish a real automated test suite.

## Scheduling tests

```text
same-time conflict
partial overlap
adjacent appointments
buffer
working hours
weekends
timezone
DST
reschedule
cancel
concurrent booking
```

## Multi-tenancy

```text
tenant A cannot read B
tenant A cannot mutate B
thread isolation
customer isolation
booking isolation
```

## AI

```text
valid structured response
malformed response
provider timeout
provider failure
fallback
prompt injection
missing service
missing address
ambiguous time
```

## Safety

```text
electrical emergency
gas/CO
water leak
sewage
HVAC emergency
unknown hazard
```

## Twilio

```text
valid signature
invalid signature
duplicate MessageSid
duplicate CallSid
unknown number
retry
```

---

# Phase 10 — Production Readiness

Before pilot:

## Infrastructure

- production secrets
- database backups
- migration strategy
- error monitoring
- uptime monitoring
- log retention
- rate limiting
- request limits
- webhook timeout handling

## Security

- dependency audit
- secret scanning
- RLS verification
- authorization tests
- CSRF/origin controls
- XSS review
- webhook signature validation

## Reliability

- idempotency
- retries
- transactional booking
- graceful provider failure
- AI fallback
- database failure handling

---

# Phase 11 — Customer Pilot

Only after the scheduling truth layer and webhook reliability are complete.

Start with:

```text
5–10 solo tradespeople
```

Focus on:

- plumbers
- electricians
- HVAC
- similar appointment-driven solo operators

Do not optimize for feature breadth.

Measure:

```text
missed calls
↓
SMS conversations
↓
qualified leads
↓
slots offered
↓
bookings
↓
completed jobs
```

Key product metrics:

```text
Missed-call recovery rate
Conversation-to-booking rate
Booking conflict rate
AI escalation rate
AI fallback rate
Customer response time
Time saved per operator
```

---

# Recommended Implementation Order

## Sprint 1 — Scheduling Core

```text
[x] Convert bookings to real timestamps
[x] Build availability engine
[x] Build conflict detection
[x] Add transactional booking
[x] Add database overlap protection
[x] Remove hardcoded slots
[x] Add scheduling tests
```

**Exit condition:** RidgeLine cannot create an overlapping booking through any code path.

---

## Sprint 2 — Domain Extraction

```text
[x] Extract booking service
[x] Extract conversation service
[x] Extract policy engine
[x] Extract safety engine
[x] Extract tenant context
[~] Reduce server.ts (net 3727 -> ~2801; extraction done, auth/CSRF middleware added back)
[~] Remove frontend business duplication
```

**Exit condition:** booking/conversation rules exist in one authoritative domain layer.

> **Partial.** Three of the six are done. The policy engine (2.4) and the safety
> engine (Phase 4) are pure modules the server and the browser both call, so the
> booking gate is no longer an `if` chain and the emergency rules exist once.
>
> The booking service (2.2) now lives in
> `packages/application/booking-service.ts` behind a `Queryable` port, so
> `server.ts` no longer knows how to build an instant, read a working window,
> or decide whether a time is free. That took 428 lines out of `server.ts`
> (3727 to 3308) and made the rules reachable by a test: the 22 booking-service
> tests run against a fake client, with no server, no database and no network.
> Two defects surfaced that no test could previously have caught, because both
> paths only ran after booting the app against live Neon:
>
> - **A degenerate working window silently made an organization unbookable.**
>   A stored `17:30` to `07:30` passed validation, produced a zero-length day,
>   and every request was then refused as "outside working hours" with nothing
>   to look at. An incoherent pair is now treated as misconfiguration and falls
>   back to a real day.
> - **`BusyInterval` had three incompatible shapes.** The conflict name shown to
>   the customer was passed through untyped casts, and the busy loader stored a
>   customer name in a field named `id` that the type did not declare. The
>   loader now returns the declared `bookingId` and `customerName`, and the
>   conflict message is type-checked and still names the customer when known.
>
> Since that note: the conversation service (2.3) is now
> `packages/application/conversation-service.ts` (processInboundSms behind a
> `Queryable` port, SAVEPOINT'd scheduling, the policy-engine cancel/reschedule
> flow moved in verbatim) with the AI pipeline (`ai-pipeline.ts`) behind it and
> `id-utils.ts`; tenant context (2.5) is `packages/application/tenant-context.ts`
> (pool-first `runTenantQuery`, all webhook/server call sites converted).
> Frontend duplication is down, not gone: availability and emergency triage are
> shared, the rest of the business logic still lives in `App.tsx`.

---

## Sprint 3 — Webhook & Security Hardening

```text
[x] Remove unknown-Twilio fallback
[x] Add MessageSid idempotency
[x] Add CallSid idempotency
[x] Make webhook DB access tenant-aware
[x] Harden authorization
[x] Remove/limit localStorage JWT
[x] Add CSRF/origin protection
```

**Exit condition:** repeated/malformed/misrouted external events cannot corrupt tenant data.

> **Done.** Unknown Twilio numbers now fail safely (SMS rejects, voice rejects,
> voice-status warns and 200s) via `packages/domain/organizations/twilio-phone.ts`.
> MessageSid and CallSid are idempotency keys (dedupe pre-check + unique indexes
> in `initDb()` and `supabase/migrations/20260929000000_webhook_idempotency.sql`).
> Both webhook DB paths run in tenant transactions
> (`runTenantQuery(pool, orgId, ...)`) so RLS applies to webhook writes. Roles
> (`packages/domain/organizations/roles.ts`) gate all 13 write routes via
> `requirePermission` (unknown/legacy roles deny writes; `users.role` defaults
> to `'owner'`). The localStorage JWT mirror is gone — cookie-only auth. A
> same-origin guard (`server.ts` ~175-212) rejects cross-origin state-changing
> `/api/*` calls unless Origin matches Host or `ALLOWED_ORIGINS`/`APP_URL`;
> `/webhooks/*` are exempt (signature auth). 159 hermetic tests pass; tsc clean.
>
> Follow-ups closed after review: (a) the customer-message INSERT in
> `conversation-service.ts` now runs inside `SAVEPOINT msg` with
> `ROLLBACK TO SAVEPOINT msg` in the 23505 branch, so a lost unique-index race
> is absorbed locally and the cache re-read works on real Postgres (tests
> assert the savepoint lifecycle). (b) The dead `FORWARD_CALLS_TO` line was
> removed from `.env.example`.
>
> Deferred (non-blocking): (c) Voice-status deliberately keeps two dedupe paths
> (pre-send guard gates the irreversible textback; in-txn re-check closes the
> persist race — same predicate, unique index backstop; consolidate in a
> future hardening pass).

---

## Sprint 4 — Next.js App Router

```text
[ ] Create apps/web
[ ] Configure Next.js App Router
[ ] Migrate authentication UI
[ ] Migrate dashboard shell
[ ] Migrate overview
[ ] Migrate dispatch
[ ] Migrate SMS
[ ] Migrate customers
[ ] Migrate services
[ ] Migrate settings
[ ] Remove Vite frontend
```

**Exit condition:** Next.js owns the web application while Express remains the backend API.

---

## Sprint 5 — Realtime UX

```text
[ ] Domain events
[ ] Realtime booking updates
[ ] Realtime SMS
[ ] Dispatch synchronization
[ ] Notifications
[ ] Optimistic UI with rollback
```

**Exit condition:** multiple dashboard sessions remain synchronized without manual refresh.

---

## Sprint 6 — Observability + Testing

```text
[ ] Structured logs
[ ] Audit events
[ ] AI decision logging
[ ] Metrics
[ ] Error monitoring
[ ] Integration tests
[ ] E2E tests
[ ] Security tests
```

**Exit condition:** production failures can be reproduced and diagnosed.

---

## Sprint 7 — Pilot

```text
[ ] Production deployment
[ ] Twilio production number
[ ] 5–10 pilot operators
[ ] Monitor every automated booking
[ ] Collect real conversation failures
[ ] Fix scheduling/AI edge cases
[ ] Measure conversion
```

**Exit condition:** operators can rely on RidgeLine for real scheduling without manual database intervention.

---

# Final Target Architecture

```text
                         ┌─────────────────────┐
                         │   Next.js App Router│
                         │                     │
                         │ Marketing           │
                         │ Dashboard           │
                         │ Dispatch            │
                         │ SMS                 │
                         │ Customers           │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Express API       │
                         └──────────┬──────────┘
                                    │
             ┌──────────────────────┼─────────────────────┐
             │                      │                     │
             ▼                      ▼                     ▼
      Conversation AI        Policy Engine        Scheduling Engine
             │                      │                     │
             └──────────────────────┼─────────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │ Application Services│
                         └──────────┬──────────┘
                                    │
                         ┌──────────▼──────────┐
                         │ PostgreSQL + RLS    │
                         │                     │
                         │ Customers           │
                         │ Conversations       │
                         │ Bookings            │
                         │ Services            │
                         │ Organizations       │
                         └──────────┬──────────┘
                                    │
                   ┌────────────────┴────────────────┐
                   ▼                                 ▼
              Twilio                            Calendar
             SMS/Voice                        Integrations
```

## The strategic rule

**Do not optimize RidgeLine for more features yet. Optimize it for trustworthy autonomous scheduling.**

The critical progression is:

```text
AI understands
      ↓
Policy decides
      ↓
Scheduler verifies
      ↓
Database guarantees
      ↓
Twilio communicates
      ↓
Next.js displays
```

That sequence gives RidgeLine a clean path from prototype to production without requiring a wholesale rewrite.
