# Task 8 — Server-side role authorization (Sprint 3, item 6.2)

## Goal
Enforce a role→permission matrix server-side. Today any authenticated user can mutate anything:
`users.role` is a free VARCHAR and no route checks it. Add a pure `can(role, permission)` matrix in
`packages/domain/organizations/roles.ts`, a `requirePermission` middleware in `server.ts`, annotate
every state-changing `/api/*` route, and widen the client `User.role` union to match.

## Files
- **Create** `packages/domain/organizations/roles.ts`
- **Create** `packages/domain/organizations/__tests__/roles.test.ts`
- **Edit** `server.ts` — add middleware; annotate routes
- **Edit** `src/types.ts` — line ~125 `User.role` union

## Design decisions (already made)
- Reads are unchanged: any authenticated user (any role) may GET. Only write routes are gated —
  no permission list for reads.
- Unknown/legacy role values get the empty permission set (deny writes) — safe default.
- `requirePermission` sits directly AFTER `requireAuth` in each route's chain (before any
  rate-limiter), reads `req.user.role` (populated by requireAuth at `server.ts:653-660` and the
  in-memory fallback), and returns 403 with a plain JSON error. It does NOT touch the DB.
- Matrix (final, do not redesign): owner/admin are full write access; dispatcher gets
  bookings/customers/sms/assistant; technician gets bookings.update only; viewer is read-only.
- `src/types.ts`: extend the union only (`'owner' | 'admin' | 'dispatcher' | 'technician' | 'viewer'`);
  no other client change. No column/constraint change to `users.role`.

## Exact code — `packages/domain/organizations/roles.ts`
```ts
export const ROLES = ['owner', 'admin', 'dispatcher', 'technician', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'bookings.create'
  | 'bookings.update'
  | 'customers.write'
  | 'services.write'
  | 'settings.write'
  | 'sms.send'
  | 'assistant.run'
  | 'organizations.switch';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [
    'bookings.create', 'bookings.update', 'customers.write', 'services.write',
    'settings.write', 'sms.send', 'assistant.run', 'organizations.switch',
  ],
  admin: [
    'bookings.create', 'bookings.update', 'customers.write', 'services.write',
    'settings.write', 'sms.send', 'assistant.run', 'organizations.switch',
  ],
  dispatcher: ['bookings.create', 'bookings.update', 'customers.write', 'sms.send', 'assistant.run'],
  technician: ['bookings.update'],
  viewer: [],
};

export function can(role: Role | string | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  const granted = ROLE_PERMISSIONS[role as Role];
  if (!granted) return false;
  return granted.includes(permission);
}
```

## `server.ts` edits
1. Import: `import { can, type Permission } from './packages/domain/organizations/roles.js';`
2. Add next to `requireAuth` (~line 620):
   ```ts
   function requirePermission(permission: Permission) {
     return (req: Request, res: Response, next: NextFunction) => {
       if (!req.user) {
         return res.status(401).json({ error: 'Authentication required.' });
       }
       if (!can(req.user.role as any, permission)) {
         return res.status(403).json({ error: `Forbidden: requires ${permission} permission.` });
       }
       return next();
     };
   }
   ```
3. Annotate exactly these routes (insert `requirePermission('<perm>')` immediately after
   `requireAuth` in the existing chain; locate each by its `app.<method>('/...')` line):
   - `POST /api/customers` (1461) → `customers.write`
   - `PATCH /api/customers/:id` (1519) → `customers.write`
   - `DELETE /api/customers/:id` (1556) → `customers.write`
   - `POST /api/bookings` (1641) → `bookings.create`
   - `PATCH /api/bookings/:id` (1779) → `bookings.update`
   - `POST /api/sms/message` (1859) → `sms.send`
   - `POST /api/sms/process` (2538) → `assistant.run` (chain becomes
     `requireAuth, requirePermission('assistant.run'), rateLimitPerOrg({ scope: 'sms-process' }), ...`)
   - `PATCH /api/organizations` (1979) → `settings.write`
   - `POST /api/organizations/switch` (2181) → `organizations.switch`
   - `PATCH /api/assistant-settings` (2053) → `settings.write`
   - `POST /api/services` (2120) → `services.write`
   - `DELETE /api/services/:id` (2158) → `services.write`
   - `POST /api/missed-call/process` (3017) → `assistant.run` (same chain pattern as sms/process)
   Do NOT annotate: any GET, any `/api/auth/*` route, `/api/neon/*`, `sms/process`'s sibling
   webhook routes (`/webhooks/*` are signature-verified and org-resolved, never user-authed).

## `src/types.ts` edit
```ts
role: 'owner' | 'admin' | 'dispatcher' | 'technician' | 'viewer';
```
(match the file's existing `User.role` line ~125; no whitespace/style change beyond the union).

## Tests — `packages/domain/organizations/__tests__/roles.test.ts`
1. Spot-check the matrix: `can('owner', 'settings.write') === true`; `can('admin', 'bookings.update') === true`; `can('dispatcher', 'bookings.update') === true`; `can('dispatcher', 'settings.write') === false`; `can('technician', 'bookings.update') === true`; `can('technician', 'bookings.create') === false`; `can('viewer', 'customers.write') === false`.
2. `can(undefined, 'bookings.create') === false`; `can(null, ...)` false; `can('scheduler', 'bookings.create') === false` (unknown role → deny).
3. Every permission appears in owner/admin: for each permission in the union, `can('owner', p)` and `can('admin', p)` are true (iterate the literal array `['bookings.create','bookings.update','customers.write','services.write','settings.write','sms.send','assistant.run','organizations.switch']`).
4. Viewer grants nothing: `can('viewer', p) === false` for all permissions.

## Verification
```bash
npx tsc --noEmit
npm test
```

## Where it fits
Sprint 3 item 6.2. Independent of Tasks 1-7 (different files); it only needs `req.user` from the
existing `requireAuth`. Task 10 mounts origin protection which layers on top of this.