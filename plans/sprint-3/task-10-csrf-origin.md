# Task 10 — CSRF / cross-origin protection (Sprint 3, item 6.3)

## Goal
The session is a cookie cookie (`ridgeline_session`, httpOnly; `sameSite: 'lax'` in dev,
`'none'` in production) — and in production a `SameSite=None` cookie is sent on cross-site
requests, so a malicious page could drive state-changing `/api/*` calls while the user is signed
in. Add a same-origin guard on all state-changing `/api/*` routes: allow when the request's
Origin/Referer matches the Host **or** is explicitly listed in `ALLOWED_ORIGINS` / `APP_URL` env;
reject everything else with 403. Webhook routes (`/webhooks/*`) are excluded — they are not
browser-session-authenticated (Twilio signature verified), and the guard must not break them.

## Files
- **Edit** `server.ts` — add the middleware near the other security middleware (after `cookieParser`,
  before the routes; mount scoped to `/api`)
- **Edit** `.env.example` — document `ALLOWED_ORIGINS`

## Design decisions (already made)
- Mounted with `app.use('/api', ...)` so `/webhooks/*` and the Vite SPA fallthrough are untouched.
- Only state-changing methods are checked (`POST`, `PUT`, `PATCH`, `DELETE`); `GET`/`HEAD`/`OPTIONS`
  pass (reads are harmless and preflights must not be blocked).
- Requests with NO Origin AND NO Referer header pass — non-browser clients (curl, integrations)
  still must satisfy `requireAuth` (cookie or Bearer), so this does not open anything.
- Origin authority order: (1) browser's own origin equals the served Host → allow; (2) origin is in
  the allow-list built from `ALLOWED_ORIGINS` (comma-separated) plus `APP_URL` (already used for
  Twilio signature validation) → allow; else 403.
- No new npm dependency; zero behavior change for the current frontend (same origin).

## Exact code — `server.ts`
Add after `cookieParser` wiring and before the first `/api` route:

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

`Request`, `Response`, `NextFunction` are already imported in `server.ts` (used by existing
middleware). If Express's `req.get` typing complains about `'referer'`, use
`req.get('referer') as string | undefined` — no other change.

## `.env.example` edit
Append to the Environment Configuration section:

```
# Comma-separated list of origins allowed to call state-changing /api routes from
# cross-origin pages (usually empty; same-origin requests are always allowed).
# APP_URL alone is sufficient when the frontend and API share a public origin.
ALLOWED_ORIGINS=""
```

## Verification
```bash
npx tsc --noEmit
npm test
```
Manual (dev server, same origin): sign in, create a booking/customer from the UI — still works.
Manual negative: `curl -i -X POST http://localhost:3000/api/customers -H "Origin: https://evil.example" -H "Content-Type: application/json" -d '{}'` → HTTP 403 without a session; with `Origin: http://localhost:3000` → 401 (auth) not 403.
Manual webhook sanity: `POST /webhooks/twilio/sms` with a valid Twilio signature still reaches the handler (no 403 from this guard).

## Where it fits
Sprint 3 item 6.3. Layers on top of Task 8 (role enforcement); independent file-wise otherwise.
Runs in parallel with Tasks 8 and 9.