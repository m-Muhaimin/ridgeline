import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOrgByTwilioNumber, normalizePhone } from '../twilio-phone.js';

test('normalizePhone ignores formatting, so a dialed number and a stored number agree', () => {
  assert.equal(normalizePhone('+1 (555) 123-4567'), normalizePhone('15551234567'));
});

test('normalizePhone treats a missing number as empty rather than throwing', () => {
  assert.equal(normalizePhone(undefined), '');
  assert.equal(normalizePhone(null), '');
});

test('findOrgByTwilioNumber matches the org that owns the number', () => {
  const org = findOrgByTwilioNumber([{ id: 'a', twilioPhoneNumber: '+15551234567' }], '15551234567');
  assert.equal(org?.id, 'a');
});

test('findOrgByTwilioNumber reads the snake_case row shape and a formatted dialed number', () => {
  const org = findOrgByTwilioNumber([{ id: 'a', twilio_phone_number: '15551234567' }], '+1 (555) 123-4567');
  assert.equal(org?.id, 'a');
});

test('findOrgByTwilioNumber returns null for an unknown number instead of an arbitrary org', () => {
  const org = findOrgByTwilioNumber([{ id: 'a', twilioPhoneNumber: '+19999999999' }], '15551234567');
  assert.equal(org, null);
});

test('findOrgByTwilioNumber returns null for no orgs and for no number', () => {
  assert.equal(findOrgByTwilioNumber([], '+15551234567'), null);
  assert.equal(findOrgByTwilioNumber([{ id: 'a' }], undefined), null);
});
