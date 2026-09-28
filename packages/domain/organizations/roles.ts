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
