# Task 9 report — remove the localStorage JWT mirror

Deletion-only. The XSS-stealable `localStorage.ridgeline_session_token` mirror and every
`Authorization: Bearer` header on the client are gone; the httpOnly `ridgeline_session` cookie
path is untouched. No new code, no new files, no server changes, no refactors, no commits.

## Files changed

- `src/App.tsx` — 5 of the brief's 7 edit sites (deletions only, 25 lines removed, 2 modified)
- `src/pages/AuthPage.tsx` — 2 sites (deletions only, 8 lines removed)

`server.ts`, `src/lib/apiFetch.ts`, `packages/**` and every other `src/` file were **not**
touched. `apiFetch` is unmodified and still supplies `credentials: 'include'` by default
(`src/lib/apiFetch.ts:40`), so the cookie rides along on every call exactly as before.

---

## `src/App.tsx` — exact deletions

All line numbers are the **pre-edit** file (`git diff` hunks confirm the context).

### Site 1 — `/api/neon/data` bootstrap (was lines 99-106)

Deleted verbatim:

```ts
      const storedToken = localStorage.getItem('ridgeline_session_token');
      const headers: Record<string, string> = {};
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }

```

and the `{ headers }` argument was dropped from the call (the `headers` object no longer
exists, so leaving it would be a `tsc` error):

```diff
-        apiFetch('/api/neon/data', { headers }).catch(() => null),
+        apiFetch('/api/neon/data').catch(() => null),
```

Result — the whole `try` head is now just the `Promise.all`:

```ts
    const start = Date.now();
    try {
      const [data, status] = await Promise.all([
        apiFetch('/api/neon/data').catch(() => null),
        apiFetch('/api/neon/status').catch(() => null)
      ]);
```

The `setOrganizations` / `setBookings` / `setThreads` / `setServices` / `setMissedCalls` /
`setCustomers` / `setSettings` block below is byte-for-byte unchanged.

### Site 2 — `/api/auth/me` call (was lines 157-163)

Deleted verbatim:

```ts
        const storedToken = localStorage.getItem('ridgeline_session_token');
        const headers: Record<string, string> = {};
        if (storedToken) {
          headers['Authorization'] = `Bearer ${storedToken}`;
        }

```

and:

```diff
-        const data = await apiFetch('/api/auth/me', { headers });
+        const data = await apiFetch('/api/auth/me');
```

### Site 3 — login-success state block (was lines 166-169)

Deleted verbatim:

```ts
          localStorage.setItem('ridgeline_user_email', data.user.email);
          if (data.token) {
            localStorage.setItem('ridgeline_session_token', data.token);
          }
```

`setCurrentUser(data.user)` is kept, exactly as the brief requires. See **Deviation 1** — the
brief described this as two lines at ~166-168; on disk it is four, because the token write was
wrapped in an `if (data.token)` guard. Both named expressions were deleted along with the now-
empty guard.

### Site 4 — auth-failure branch (was lines 172-173)

Deleted verbatim:

```ts
          localStorage.removeItem('ridgeline_session_token');
          localStorage.removeItem('ridgeline_user_email');
```

`setCurrentUser(null)` is kept.

### Site 5 — `setCurrentUser`-on-bootstrap / `handleAuthSuccess` (was line 189)

Deleted verbatim:

```ts
    localStorage.setItem('ridgeline_user_email', user.email);
```

`setCurrentUser(user)` and the `syncFromNeon(true)` / `navigate` calls around it are unchanged.

### Site 6 — logout call (was lines 200-205)

Deleted verbatim:

```ts
      const storedToken = localStorage.getItem('ridgeline_session_token');
      const headers: Record<string, string> = {};
      if (storedToken) {
        headers['Authorization'] = `Bearer ${storedToken}`;
      }
```

and the `headers` shorthand was dropped from the bare `fetch` (this one is a **plain `fetch`,
not `apiFetch`**, so it is the one call site that had to keep its own `credentials: 'include'`;
that option is retained):

```diff
-      await fetch('/api/auth/logout', { method: 'POST', headers, credentials: 'include' });
+      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
```

The `catch`/`console.warn('Logout error:', e)` is unchanged.

### Site 7 — logout cleanup (was lines 210-211)

Deleted verbatim:

```ts
    localStorage.removeItem('ridgeline_session_token');
    localStorage.removeItem('ridgeline_user_email');
```

`setCurrentUser(null)`, `showToast('Signed out of RidgeLine.')` and `navigate('/auth')` are
unchanged.

---

## `src/pages/AuthPage.tsx` — exact deletions

### Site 1 — form-submit success path (was lines 73-76)

Deleted verbatim:

```ts
      if (data.token) {
        localStorage.setItem('ridgeline_session_token', data.token);
      }
      localStorage.setItem('ridgeline_user_email', data.user.email);
```

`showToast(...)`, `onAuthSuccess(data.user)` and `navigate('/')` are kept. This block is the
**shared login *and* register** path — `endpoint` is chosen from `mode` on line 57 and the
toast ternary on line 73 branches on `mode`, so brief items 1 and 2 are the *same* code here.
See **Deviation 2**.

### Site 2 — one-click demo login (was lines 98-101)

Deleted verbatim:

```ts
        if (data.token) {
          localStorage.setItem('ridgeline_session_token', data.token);
        }
        localStorage.setItem('ridgeline_user_email', data.user.email);
```

`if (data.success && data.user) {`, `showToast('Logged in as Mark Kowalski (Demo Account)')`,
`onAuthSuccess(data.user)` and `navigate('/')` are kept. See **Deviation 3** — the brief called
this the "register success path"; it is actually `handleQuickDemo`.

The `headers: { 'Content-Type': 'application/json' }` lines in both `apiFetch` POST bodies
(AuthPage 64 and 93) are **kept** — they are request-content headers, unrelated to auth.

---

## Deviations from the brief

1. **`App.tsx` site 3 was four lines, not two.** The brief said "Lines ~166-168: delete
   `localStorage.setItem('ridgeline_user_email', …)` and
   `localStorage.setItem('ridgeline_session_token', …)`". On disk the token write is nested in a
   truthiness guard — `if (data.token) { … }` — so the block is 4 physical lines. I deleted all
   four: both named expressions plus the emptied `if` wrapper, which would otherwise be a
   useless `if (data.token) {}`. Net result is identical to the brief's intent and the diff is
   still deletion-only. Same shape applied to both `AuthPage` sites.

2. **The brief's `AuthPage` items 1 and 2 are the same code block.** There is no separate
   register success block: `handleSubmit` picks `/api/auth/login` vs `/api/auth/register` from
   `mode` (line 57) and has one shared success path. Deleting the two named expressions from
   that one path covers both modes. I treated brief item 1 as covering login+register and
   proceeded to a second site only because the grep gate proved a second block existed.

3. **`AuthPage` lines 98-101 are `handleQuickDemo` (one-click demo login), not the register
   success path.** The brief's label was wrong; the content matched its two named expressions
   exactly. It is a second real mirror of the token, so leaving it would have failed the
   `grep` gate and left the XSS surface half-open. Deleted, and the surrounding
   `if (data.success && data.user)` / `showToast` / `onAuthSuccess` / `navigate` kept as-is.

4. **`{ headers }` had to be dropped from three call sites** (`/api/neon/data`, `/api/auth/me`,
   `/api/auth/logout`). The brief anticipated this for the headers-object case ("remove any now-
   empty headers object, keeping the fetch options otherwise intact") and listed the same
   deletion for sites 1/2/6; the `fetch` call-site argument removal in site 6 is the same
   mechanical consequence, not a design change. No other option, header or call shape changed.

5. **Line numbers otherwise held.** Every one of the brief's seven `App.tsx` sites and both
   `AuthPage.tsx` sites was verified by content before deleting; no site was already
   simplified. `App.tsx` went 1058 → 1032 lines, `AuthPage.tsx` 299 → 295.

---

## Verification

**1. Typecheck — PASS**

```
$ npx tsc --noEmit
TSC_EXIT=0
```

**2. Forbidden-token grep — PASS (empty)**

```
$ grep -rn "ridgeline_session_token\|ridgeline_user_email\|Authorization" src/
GREP_EXIT=1        # 1 = no matches
```

No output. Additionally confirmed no stale references survive the deletions:

```
$ grep -rn "localStorage" src/          # (none)
$ grep -rn "data\.token" src/           # (none)
$ grep -rn "{ headers }\|headers\['" src/  # (none)
```

The only remaining `headers` in `src/` are 13 unrelated
`headers: { 'Content-Type': 'application/json' }` request-content headers and one
`res.headers.get('content-type')` inside `apiFetch`; one lowercase prose match ("quote headers"
in `OrganizationSettings.tsx:244`) does not match the `Authorization` pattern.

**3. Test suite — PASS**

```
$ npm test
ℹ tests 159
ℹ suites 12
ℹ pass 159
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1194.891
```

Baseline before my edits was 155/155. The +4 is **not** from this task — see Concerns.

**4. Not run: manual browser check.** The brief's manual step (log in, hard-refresh, confirm
authenticated data still loads) needs a running server plus a real Neon/Twilio config, and
per `AGENTS.md` a missing `DATABASE_URL` silently serves in-memory fixtures — a green manual
pass would prove nothing here. `npm test` and `tsc` are the configured verification story and
both pass. The reasoning that the cookie path is intact: the server still sets
`ridgeline_session` on the same login/register responses, `apiFetch` still defaults to
`credentials: 'include'`, and the cookie is now the *only* client credential in play, so the
auth path is strictly narrower than before (it previously worked over both cookie and Bearer).

---

## Concerns

1. **The working tree contains concurrent, uncommitted changes outside this task.** `git status`
   shows staged modifications to `server.ts` (`MM`, ~999 lines) and to
   `packages/domain/conversations/policy-engine.ts` + its test, plus untracked new
   `packages/application/*` files, a new `supabase/migrations/` file, and a stray tracked
   `__pycache__/.patch.cpython-312.pyc`. These are the server-half tasks (8/10) and earlier
   domain work, **not** mine — I wrote only `src/App.tsx` and `src/pages/AuthPage.tsx`, both of
   which show as unstaged (` M`) modifications.
   This is the likely source of the 155 → 159 test delta: the staged
   `policy-engine.test.ts` gained 6 assertions versus `HEAD` (32 → 38 on disk). Verified by
   `git show HEAD:… | grep -c "assert\."` vs the on-disk count. The suite is decoupled from
   `src/` (no test imports `src/` or `server.ts`), so the delta cannot have been caused by my
   deletion-only edits.
2. **A stray `__pycache__/.patch.cpython-312.pyc` is staged in the repo.** Unrelated to Task 9
   and out of my scope, but it should not be committed.
3. **The server-side dual auth path is still live by design** (`/api/auth/login`,
   `/api/auth/register`, `/api/auth/me` still return `token` in JSON, and `requireAuth` still
   accepts `Authorization: Bearer`). Task 9 only removes the client *usage*, per the brief. The
   JSON `token` field is now ignored by every client call site, so it is dead payload on the
   wire until the server half lands.
4. **Not verified at runtime** (see Verification item 4) — if Probe needs a real login +
   hard-refresh + reload proof, that has to run against a live server with `DATABASE_URL` set.
