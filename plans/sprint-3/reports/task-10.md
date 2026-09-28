# Task 10 — CSRF / cross-origin guard — Implementation Report

**Status:** COMPLETE
**Files changed:** `server.ts` (+39 lines, single insertion hunk), `.env.example` (+5 lines)
**Commits:** none (repo convention — no commit requested)

---

## 1. `server.ts` — insertion point

The brief requires the block after the `cookieParser` wiring and before the first `/api` route.
Both anchors confirmed before editing:

| Anchor | Line (pre-edit) | Line (post-edit) |
|---|---|---|
| `app.use(cookieParser(COOKIE_SECRET));` | 173 | 173 |
| **guard block inserted** | — | **175–212** |
| `app.post('/api/auth/register', …)` | 569 | 608 |

**Chosen insertion site: immediately after line 173**, i.e. directly below the `cookieParser`
wiring with one blank line separating.

- **Prev statement:** `app.use(cookieParser(COOKIE_SECRET));` (line 173) — the brief's explicit anchor.
- **Next statement:** `// Initialize Google GenAI client if API key is present` (line 214), followed by the
  Gemini client bootstrap at 215.

### Ordering proof

- Guard mount (`app.use('/api', …)`, line 208) is **textually after** `cookieParser` (173). ✓
- Guard mount (208) is **textually before** `app.post('/api/auth/register', …)` (608). ✓
- I explicitly checked there were **no** `app.use|get|post|put|patch|delete|all(...)` registrations
  anywhere in the pre-edit range 174–568, so 174 is both "right after cookieParser" and
  "before the first `/api` route" with no ambiguity. Mounting there means the guard is
  unconditionally upstream of every `/api` handler, including ones added later.

### Webhook exclusion proof

The guard is mounted with the `'/api'` path prefix, so it cannot match the Twilio routes, which are
registered at a different prefix and a later line:

```
2234: app.post('/webhooks/twilio/sms',        twilioFormParser, verifyTwilioSignature, …)
2375: app.post('/webhooks/twilio/voice',      twilioFormParser, verifyTwilioSignature, …)
2399: app.post('/webhooks/twilio/voice-status', twilioFormParser, verifyTwilioSignature, …)
```

None begin with `/api`, so the guard is never entered for them. The Vite SPA fallthrough and the
terminal `/api/*` JSON 404 are likewise outside the prefix. No ordering dependency on those.

### Final code as landed (lines 175–212, verbatim from the brief)

```ts
// CSRF / cross-origin guard: the session cookie can be SameSite=None in
// production, so a signed-in user's browser would happily attach it to a
// request originating from an attacker's page. State-changing /api calls must
// prove they come from this app's origin (or an explicitly allowed one).
// Webhook routes are deliberately excluded (Twilio signature verification is
// their auth; they are never driven by a user's browser session).
function buildAllowedOrigins(): string[] {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const appUrl = process.env.APP_URL;
  const set = new Set<string>([...fromEnv, ...(appUrl ? [appUrl] : [])]);
  return [...set];
}

function isAllowedOrigin(req: Request): boolean {
  const originHeader = req.get('origin') || req.get('referer');
  if (!originHeader) return true; // non-browser client; requireAuth still applies

  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    return false;
  }

  const host = req.get('host') || '';
  if (originUrl.host === host) return true; // same origin the app is served from

  return buildAllowedOrigins().includes(originUrl.origin);
}

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (isAllowedOrigin(req)) return next();
  return res.status(403).json({ error: 'Cross-origin request rejected.' });
});
```

Note: `Request` here is Express's `Request` (imported at `server.ts:1`), shadowing the fetch
`Request` global. `URL` is not shadowed, so `new URL(...)` resolves to the global — as the brief intends.

---

## 2. `.env.example` — placement

Located the Environment Configuration section via `APP_URL` (line 9 pre-edit). The exact 4-line
block from the brief was appended **immediately after the `APP_URL="MY_APP_URL"` line** and its
existing trailing blank line, i.e. new lines 10–14:

```diff
 # Used for self-referential links, OAuth callbacks, and API endpoints.
 APP_URL="MY_APP_URL"
 
+# Comma-separated list of origins allowed to call state-changing /api routes from
+# cross-origin pages (usually empty; same-origin requests are always allowed).
+# APP_URL alone is sufficient when the frontend and API share a public origin.
+ALLOWED_ORIGINS=""
+
 # NEON_API_KEY: API Key for Neon platform authentication
```

Rationale: the block is documented next to `APP_URL` because the brief's own text makes `APP_URL`
the second allow-list source — a reader editing one should see the other. The rest of the file is
untouched; the diff is exactly `+5` lines, 0 deletions.

The dead `FORWARD_CALLS_TO="+15551234567"` line (now line 33) was **left alone** as instructed — it
belongs to a separate follow-up.

---

## 3. Verification summary

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **exit 0** — no errors |
| Test suite | `npm test` | **exit 0 — 159 pass / 0 fail / 0 skipped** (12 suites, 1071ms) |
| Guard mount count | `grep -n "app.use('/api'" server.ts` | **exactly 1** → line 208 |
| Rejection string count | `grep -n "Cross-origin request rejected" server.ts` | **exactly 1** → line 211 |
| `buildAllowedOrigins` occurrences | `grep -n "buildAllowedOrigins" server.ts` | **exactly 2** → def `181`, single call `205` (inside `isAllowedOrigin`) |
| `isAllowedOrigin` occurrences | `grep -n "isAllowedOrigin" server.ts` | **exactly 2** → def `191`, single call `210` (inside the mount) |
| Spot-read of mount site | `read server.ts 170–214` | guard at 175–212 sits between `cookieParser` (173) and `// Initialize Google GenAI` (214); register route at 608 is downstream |
| Pre-edit route scan | `awk` over 174–568 | zero route registrations — insertion point unambiguous |
| Webhook prefix scan | `grep` | all 3 Twilio routes under `/webhooks/twilio/*`, outside the `/api` prefix |

Baseline test count (159) is unchanged, confirming the middleware is inert with respect to unit tests.

### Diff hygiene

`git diff -U2 -- server.ts` contains exactly **one** hunk for this task, and every line inside it is
either an `+` (the 39-line guard block) or an unchanged context line (`app.use(cookieParser…)` /
`// Initialize Google GenAI…`). No existing line was modified or removed by this task. The large
overall `server.ts` diff stat (302/780) is the pre-existing staged WIP from Tasks 1–9
(`git status` showed `MM server.ts` before I started) and was not authored here.

---

## 4. Deviations

**None.**

The brief anticipated one possible deviation — "If Express's `req.get` typing complains about
`'referer'`, use `req.get('referer') as string | undefined`". That fallback was **not needed**:
the installed `@types/express` types `get(name: string): string | undefined`, so
`req.get('origin') || req.get('referer')` typechecks as-is. `npx tsc --noEmit` exits 0 against the
verbatim block, so the brief's primary instruction stands and no cast was added.

No other deviations. No design changes, no extra endpoints, no helper extraction, no new deps.

---

## 5. Behavioural notes for review

Carried over from the brief's design decisions, restated here because they are audit-relevant:

1. **Method gate** — only `POST`/`PUT`/`PATCH`/`DELETE` are inspected. `GET`/`HEAD`/`OPTIONS` call
   `next()` first, so reads and CORS preflights are never blocked.
2. **Headerless requests pass** — a request with neither `Origin` nor `Referer` returns `true`
   immediately. This is intentional for curl/server-to-server integrations; those paths still have to
   clear `requireAuth` (cookie or Bearer), so it is not an authz bypass.
3. **Same-origin beats the allow-list** — `originUrl.host === req.get('host')` is checked before the
   env allow-list, so the current frontend works with zero configuration.
4. **Malformed header is rejected, not ignored** — `new URL()` throwing yields `return false` (403),
   fail-closed. Note the asymmetry with point 2: *absent* header passes, *garbage* header fails.
5. **Unparsed URL returns 403** — `new URL(originHeader)` parses the Referer as a URL and only
   `.origin` is compared, so a Referer like `http://host/a/b` correctly reduces to `http://host`.

### Suggested Probe targets (manual, not run here — no dev server in this environment)

- `curl -i -X POST http://localhost:3000/api/customers -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}'` → expect **403** `Cross-origin request rejected.`
- same request with `-H "Origin: http://localhost:3000"` → expect **401** (auth), not 403.
- `GET /api/...` with `Origin: https://evil.example` → expect it to reach the handler (reads exempt).
- `POST /webhooks/twilio/sms` with a valid Twilio signature → expect the handler to run, no 403.
- Set `ALLOWED_ORIGINS="https://app.example.com"` and repeat the first curl with that Origin → expect 401.
