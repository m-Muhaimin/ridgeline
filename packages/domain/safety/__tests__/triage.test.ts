import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEmergency } from '../triage.js';

test('catches a burst pipe and tells them to shut the water off', () => {
  const t = detectEmergency('my pipe burst and water is everywhere');
  assert.equal(t.isEmergency, true);
  assert.equal(t.category, 'water');
  assert.match(t.guidance, /main water valve/i);
});

test('a gas leak says leave, never operate a valve', () => {
  const t = detectEmergency('I smell gas, there has been a hissing sound');
  assert.equal(t.isEmergency, true);
  assert.equal(t.category, 'gas');
  assert.match(t.guidance, /leave/i);
  assert.doesNotMatch(t.guidance, /water valve/i);
});

test('a gas smell outranks a looser match on a shared word', () => {
  // "leak" would otherwise win and hand out water advice.
  const t = detectEmergency('possible gas leak near the water heater');
  assert.equal(t.category, 'gas');
});

test('fire tells them to get out and call 911', () => {
  const t = detectEmergency('there is smoke coming from the outlet');
  assert.equal(t.isEmergency, true);
  assert.match(t.guidance, /911/);
});

test('sewage is not treated as a plain water leak', () => {
  assert.equal(detectEmergency('sewage backup in the basement').category, 'sewage');
  assert.equal(detectEmergency('sewer backup in the basement').category, 'sewage');
});

test('no heat is an emergency with heating advice, not a shutoff instruction', () => {
  const t = detectEmergency('the heat is out and it is freezing');
  assert.equal(t.category, 'heat');
  assert.doesNotMatch(t.guidance, /water valve/i);
});

test('an ordinary booking request is not an emergency', () => {
  const t = detectEmergency('can I book the water heater replacement for Tuesday?');
  assert.equal(t.isEmergency, false);
  assert.equal(t.guidance, '');
  assert.equal(t.matchedKeyword, null);
});

test('a routine question mentioning a part is not an emergency', () => {
  assert.equal(detectEmergency('how much does a new faucet cost?').isEmergency, false);
  assert.equal(detectEmergency('do you carry spark plugs?').isEmergency, false);
});

test('the organization can extend the keyword list', () => {
  assert.equal(detectEmergency('the well pump died', []).isEmergency, false);
  const t = detectEmergency('the well pump died', ['well pump', 'solar']);
  assert.equal(t.isEmergency, true);
  assert.equal(t.matchedKeyword, 'well pump');
});

test('configured keywords do not shadow the built-in categories', () => {
  const t = detectEmergency('flooding the kitchen', ['kitchen']);
  assert.equal(t.category, 'water');
});

test('a configured keyword under three characters is ignored as noise', () => {
  assert.equal(detectEmergency('need a quote', ['re', 'a', 'th']).isEmergency, false);
});

test('empty and missing input is not an emergency', () => {
  assert.equal(detectEmergency('').isEmergency, false);
  assert.equal(detectEmergency(undefined as unknown as string).isEmergency, false);
  assert.equal(detectEmergency('   ').isEmergency, false);
});

test('every emergency hands back actionable guidance', () => {
  const phrases = [
    'smoke everywhere', 'i smell gas', 'sparks from the panel', 'pipe burst',
    'sewage backup', 'no heat', 'my well pump died',
  ];
  for (const p of phrases) {
    const t = detectEmergency(p, ['well pump']);
    assert.equal(t.isEmergency, true, `expected emergency for: ${p}`);
    assert.ok(t.guidance.length > 20, `guidance too thin for: ${p}`);
  }
});

test('a configured loose keyword does not page the owner over a price question', () => {
  // Apex configures 'spark', which would otherwise fire on this.
  const t = detectEmergency('do you carry spark plugs, and what is the price?', ['spark', 'leak']);
  assert.equal(t.isEmergency, false);
});

test('a real flood still counts even if the customer also asks the price', () => {
  const t = detectEmergency('how much to fix it, the kitchen is flooding now', ['spark']);
  assert.equal(t.isEmergency, true);
  assert.equal(t.category, 'water');
});

test('a configured keyword is ignored for questions but honoured for statements', () => {
  assert.equal(detectEmergency('the well pump died', ['well pump']).isEmergency, true);
  assert.equal(detectEmergency('do you service well pumps?', ['well pump']).isEmergency, false);
});
