# Task 9 — Remove the localStorage JWT mirror (Sprint 3, item 6.1)

## Goal
The SPA currently mirrors the session token into `localStorage.ridgeline_session_token` and
re-sends it as an `Authorization: Bearer` header on every API call. The httpOnly
`ridgeline_session` cookie (set by `setSessionCookie`, `sameSite`/`secure` per environment) already
authenticates every request — `apiFetch` (`src/lib/apiFetch.ts`) sends `credentials: 'include'` by
default and adds no headers itself. Remove the localStorage mirror and all Bearer headers; the
cookie path is unchanged. This removes the XSS-stealable token surface.

## Files
- **Edit** `src/App.tsx`
- **Edit** `src/pages/AuthPage.tsx`

Do NOT edit `server.ts` — the login/register/me handlers still return `token` in JSON and
`requireAuth` still accepts a Bearer header; that server-side dual path stays live (removing the
client usage is the task).

## Design decisions (already made)
- `apiFetch(path, options)` is called without a headers object; `credentials: 'include'` (its
  default) carries the cookie. The `data.token` field from login/register responses is ignored
  (the server still sets the cookie on the same response).
- The unused `ridgeline_user_email` key dies with it — it was written and never read.
- All state updates (`setCurrentUser`, `isAuthenticated` logic) remain exactly as-is; only storage
  and header lines are removed.

## Exact edits — `src/App.tsx` (all line refs from the current file)
1. Lines ~99-103 (`/api/neon/data` bootstrap call): delete the two lines
   ```ts
   const storedToken = localStorage.getItem('ridgeline_session_token');
   ```
   and the `headers['Authorization'] = \`Bearer ${storedToken}\`;` line (plus the `const headers: Record<string, string> = {};` line if it was declared only for this — check the block and remove any now-empty headers object, keeping the fetch options otherwise intact).
2. Lines ~157-161 (`/api/auth/me` call): same deletion.
3. Lines ~166-168: delete
   ```ts
   localStorage.setItem('ridgeline_user_email', data.user.email);
   ```
   and
   ```ts
   localStorage.setItem('ridgeline_session_token', data.token);
   ```
   Keep the `setCurrentUser(data.user)` call.
4. Lines ~172-173 (the auth-failure branch): delete both `localStorage.removeItem(...)` lines.
5. Line ~189: delete `localStorage.setItem('ridgeline_user_email', user.email);`.
6. Lines ~200-203 (logout): delete the `storedToken` read and the Bearer header line.
7. Lines ~210-211: delete both `localStorage.removeItem(...)` lines.

## Exact edits — `src/pages/AuthPage.tsx`
1. Lines 73-76 (login success path): delete
   ```ts
   localStorage.setItem('ridgeline_session_token', data.token);
   localStorage.setItem('ridgeline_user_email', data.user.email);
   ```
   Keep the navigation/state calls around them.
2. Lines 98-101 (register success path): same two deletions.

## Verification
```bash
npx tsc --noEmit
npm test
```
`grep -rn "ridgeline_session_token\|ridgeline_user_email\|Authorization" src/` must return nothing.
Manual (if a dev server is available): log in, hard-refresh, and confirm the app still loads
authenticated data (the cookie survives; previously the /api/auth/me call used the token — now it
relies on the cookie exactly like every other call).

## Where it fits
Sprint 3 item 6.1, frontend half of the auth hardening (Tasks 8 + 10 are the server half). No
dependencies; runs in parallel with Tasks 8 and 10 file-wise.