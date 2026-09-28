import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../roles.js';

const ALL_PERMISSIONS = [
  'bookings.create',
  'bookings.update',
  'customers.write',
  'services.write',
  'settings.write',
  'sms.send',
  'assistant.run',
  'organizations.switch',
] as const;

test('the role matrix grants exactly what each role is supposed to have', () => {
  assert.equal(can('owner', 'settings.write'), true);
  assert.equal(can('admin', 'bookings.update'), true);
  assert.equal(can('dispatcher', 'bookings.update'), true);
  assert.equal(can('dispatcher', 'settings.write'), false);
  assert.equal(can('technician', 'bookings.update'), true);
  assert.equal(can('technician', 'bookings.create'), false);
  assert.equal(can('viewer', 'customers.write'), false);
});

test('a missing or unknown role is denied rather than defaulted to a real one', () => {
  assert.equal(can(undefined, 'bookings.create'), false);
  assert.equal(can(null, 'bookings.create'), false);
  assert.equal(can('', 'bookings.create'), false);
  assert.equal(can('scheduler', 'bookings.create'), false);
});

test('owner and admin cover every permission in the union', () => {
  for (const permission of ALL_PERMISSIONS) {
    assert.equal(can('owner', permission), true, `owner should hold ${permission}`);
    assert.equal(can('admin', permission), true, `admin should hold ${permission}`);
  }
});

test('viewer is read-only, so it holds no permission at all', () => {
  for (const permission of ALL_PERMISSIONS) {
    assert.equal(can('viewer', permission), false, `viewer must not hold ${permission}`);
  }
});
