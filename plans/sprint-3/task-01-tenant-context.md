# Task 1 — Extract `runTenantQuery` (Sprint 2, item 2.5)

## Goal
Move the tenant-context transaction helper out of `server.ts` into `packages/application/tenant-context.ts`,
export the port types, and rewrite every existing call site to pass the pool first. Behavior identical;
no route logic changes.

## Files
- **Create** `packages/application/tenant-context.ts`
- **Create** `packages/application/__tests__/tenant-context.test.ts`
- **Edit** `server.ts` — delete the local `runTenantQuery` (currently ~lines 516-545) and its `Queryable`/`PoolClient` type declarations if local; add the import; update all call sites.

## Design decisions (already made — do not revisit)
- New signature is `runTenantQuery(db, orgId, userId, callback)` — pool first, like the rest of the package-code APIs.
- DB access is behind two ports: `Queryable` (the `{ query }` shape the callbacks use) and `Connectable` (a thing with `connect(): Promise<PoolClientLike>`). Tests fake both.
- The `SET LOCAL ROLE ridgeline_app` statement keeps its existing try/catch (role may not be provisioned in preview); `set_config('app.current_user_id', ...)` is skipped when `userId` is `null`.
- Rollback on throw; `release()` in `finally`.

## Exact code — `packages/application/tenant-context.ts`
```ts
export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export type PoolClientLike = Queryable & { release: () => void };

export type Connectable = {
  connect: () => Promise<PoolClientLike>;
};

export async function runTenantQuery<T>(
  db: Connectable,
  orgId: string,
  userId: string | null,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_organization_id', $1, true);`, [orgId]);
    if (userId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true);`, [userId]);
    }
    try {
      await client.query('SET LOCAL ROLE ridgeline_app;');
    } catch (e) {
      // Role might not be provisioned yet in preview environment
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
```
Copy the body from the current `server.ts:-516-545` verbatim first, then delete the server copy and keep the exported version above. Verify the two match semantically (the server version must be the only source this task changes; if the server version has a different statement order or extra statements, preserve the server behavior exactly — the block above is the known-good shape from the current file).

## `server.ts` edits
1. Add at the top import block:
   `import { runTenantQuery } from './packages/application/tenant-context.js';`
2. Delete the local `runTenantQuery` function and any local `type Queryable`/`PoolClient` type aliases that exist solely for it. (Keep `pool` and its `Pool | null` type — `Pool` satisfies `Connectable` structurally, so no cast is needed.)
3. Rewrite every call site from
   `runTenantQuery(orgId, userId, async (client) => { ... })` → `runTenantQuery(pool, orgId, userId, async (client) => { ... })`
   Current call sites (locate by symbol, line numbers will have drifted after earlier edits; there are ~13): 1033, 1243, 1447, 1473, 1528, 1564, 1674, 1814, 1888, 1992, 2072, 2129, 2166 — spread across `complete-onboarding`, `neon/data`, `customers` GET/POST/PATCH/DELETE, `bookings` POST/PATCH, `sms/message`, `organizations` PATCH, `assistant-settings` PATCH, `services` POST/DELETE, `organizations/switch`. Use a repo-wide grep for `runTenantQuery(` to find them all — there must be no remaining single-argument-form call.
4. Leave `if (pool) { ... }` guards exactly as they are.

## Tests — `packages/application/__tests__/tenant-context.test.ts`
Use `node:test` + `node:assert/strict`. Build a fake `Connectable` that returns a fake client which records every `query(text, params)` call.

Test cases (all must pass against the new helper only):
1. **Happy path:** `runTenantQuery(fakeDb, 'org-1', 'user-7', fn)` runs, in order: `BEGIN`, `set_config` org `'org-1'`, `set_config` user `'user-7'`, `SET LOCAL ROLE ridgeline_app;`, then the callback's queries, then `COMMIT`; `release()` called exactly once; result is the callback's return value.
2. **userId null:** no `app.current_user_id` set_config is issued; everything else identical.
3. **Rollback on error:** callback throws → `ROLLBACK` issued (not `COMMIT`), error rethrown, `release()` still called.
4. **Role failure tolerated:** fake client throws on `SET LOCAL ROLE ridgeline_app;` → transaction still proceeds to the callback (no rethrow), `COMMIT` runs.

## Verification
```bash
npx tsc --noEmit
npm test
```
Also: `grep -n "runTenantQuery(" server.ts` must show only `runTenantQuery(pool, ` call forms.

## Where it fits
Task 1 is the shared tenant-transaction primitive (2.5). Tasks 4 and 7 depend on its signature: they will call `runTenantQuery(pool, org.id, null, ...)` in the webhook handlers.