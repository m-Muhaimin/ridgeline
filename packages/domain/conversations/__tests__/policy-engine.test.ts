import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, isWriteAction, type PolicyFacts } from '../policy-engine.js';

const base = (over: Partial<PolicyFacts> = {}): PolicyFacts => ({
  intent: 'book',
  urgency: 'routine',
  serviceIdentified: true,
  addressKnown: true,
  requestedSlot: '09:00 AM - 11:00 AM',
  slotResolution: 'available',
  autoConfirmEnabled: true,
  hasExistingBooking: false,
  ...over,
});

test('books when the customer stated a time and it was verified free', () => {
  const d = decide(base());
  assert.equal(d.action, 'confirm_booking');
  assert.equal(d.mayWrite, true);
});

test('never writes without a stated time, however confident the model is', () => {
  const d = decide(base({ requestedSlot: null, slotResolution: 'unstated' }));
  assert.equal(d.action, 'propose_slot');
  assert.equal(d.mayWrite, false);
});

test('does not book a time that is taken or outside working hours', () => {
  for (const slotResolution of ['unavailable', 'unstated'] as const) {
    const d = decide(base({ slotResolution }));
    assert.equal(d.action, 'propose_slot');
    assert.equal(d.mayWrite, false);
  }
});

test('honours a disabled auto-confirm switch', () => {
  const d = decide(base({ autoConfirmEnabled: false }));
  assert.equal(d.action, 'propose_slot');
  assert.equal(d.mayWrite, false);
  assert.match(d.reason, /auto-confirm disabled/);
});

test('a disabled auto-confirm switch still stops a reschedule write', () => {
  const d = decide(base({ intent: 'reschedule', hasExistingBooking: true, autoConfirmEnabled: false }));
  assert.equal(d.mayWrite, false);
});

test('reschedule moves a booking only when one exists and the time is free', () => {
  assert.equal(decide(base({ intent: 'reschedule', hasExistingBooking: true })).action, 'reschedule');
  assert.equal(decide(base({ intent: 'reschedule', hasExistingBooking: false })).action, 'answer');
  assert.equal(
    decide(base({ intent: 'reschedule', hasExistingBooking: true, slotResolution: 'unavailable' })).action,
    'propose_slot',
  );
});

test('cancel requires an existing booking', () => {
  assert.equal(decide(base({ intent: 'cancel', hasExistingBooking: true })).action, 'cancel');
  assert.equal(decide(base({ intent: 'cancel', hasExistingBooking: false })).action, 'answer');
});

test('an inquiry never touches the schedule', () => {
  const d = decide(base({ intent: 'inquiry', requestedSlot: null, slotResolution: 'unstated' }));
  assert.equal(d.action, 'answer');
  assert.equal(d.mayWrite, false);
});

test('an emergency books on a verified opening but still pulls in a human', () => {
  const d = decide(base({ intent: 'emergency', urgency: 'emergency', serviceIdentified: false }));
  assert.equal(d.action, 'confirm_booking');
  assert.equal(d.mayWrite, true);
  assert.equal(d.requiresHuman, true);
});

test('an emergency with no opening offers real ones rather than inventing one', () => {
  const d = decide(base({
    intent: 'emergency', urgency: 'emergency', requestedSlot: null, slotResolution: 'unstated',
  }));
  assert.equal(d.action, 'propose_slot');
  assert.equal(d.mayWrite, false);
  assert.equal(d.requiresHuman, true);
});

test('an emergency is never silently dropped by an inquiry intent', () => {
  // The model may mislabel the intent; urgency is the stronger signal.
  const d = decide(base({ intent: 'inquiry', urgency: 'emergency', requestedSlot: null, slotResolution: 'unstated' }));
  assert.equal(d.requiresHuman, true);
});

test('isWriteAction matches every action that may write', () => {
  for (const a of ['confirm_booking', 'reschedule', 'cancel'] as const) {
    assert.equal(isWriteAction(a), true);
  }
  for (const a of ['answer', 'quote', 'propose_slot', 'escalate'] as const) {
    assert.equal(isWriteAction(a), false);
  }
});

test('no combination of facts yields a write without a verified opening', () => {
  const intents = ['book', 'confirm', 'reschedule', 'cancel', 'inquiry', 'emergency'] as const;
  const resolutions = ['available', 'unavailable', 'unstated'] as const;
  for (const intent of intents) {
    for (const slotResolution of resolutions) {
      for (const autoConfirmEnabled of [true, false]) {
        for (const hasExistingBooking of [true, false]) {
          for (const requestedSlot of ['09:00 AM - 11:00 AM', null]) {
            const d = decide(base({ intent, slotResolution, autoConfirmEnabled, hasExistingBooking, requestedSlot }));
            if (d.mayWrite && (intent === 'book' || intent === 'confirm')) {
              // The only way a new booking may be written is a verified,
              // customer-stated time with auto-confirm on.
              assert.equal(slotResolution, 'available');
              assert.equal(autoConfirmEnabled, true);
              assert.ok(requestedSlot, 'a write must trace back to a stated time');
            }
          }
        }
      }
    }
  }
});

test('a disabled auto-confirm switch also stops a cancel', () => {
  const d = decide(base({ intent: 'cancel', hasExistingBooking: true, autoConfirmEnabled: false }));
  assert.equal(d.mayWrite, false);
});

test('an emergency still books when auto-confirm is off, and still pages a human', () => {
  // Safety outranks process: a burst needs a crew, not an approval dialog.
  const d = decide(base({ intent: 'emergency', urgency: 'emergency', autoConfirmEnabled: false }));
  assert.equal(d.mayWrite, true);
  assert.equal(d.requiresHuman, true);
});

// --- cancellation and the auto-confirm switch -------------------------------
// A customer cancelling never states a time. These cover that shape, which is
// the only shape a cancellation actually arrives in.

const cancelFacts = (over: any = {}) => base({ intent: 'cancel', requestedSlot: null, hasExistingBooking: true, ...over });

for (const slotResolution of ['available', 'unavailable', 'unstated'] as const) {
  test(`auto-confirm disabled blocks a cancellation (slotResolution ${slotResolution})`, () => {
    const d = decide(cancelFacts({ slotResolution, autoConfirmEnabled: false }));
    assert.equal(d.mayWrite, false);
    assert.equal(d.action, 'cancel', 'the customer still gets a cancellation reply, from a human');
  });
}

test('auto-confirm enabled lets a cancellation through', () => {
  const d = decide(cancelFacts({ slotResolution: 'unstated', autoConfirmEnabled: true }));
  assert.equal(d.action, 'cancel');
  assert.equal(d.mayWrite, true);
});

test('a cancellation still needs a booking on the schedule', () => {
  const d = decide(cancelFacts({ hasExistingBooking: false, autoConfirmEnabled: true }));
  assert.equal(d.mayWrite, false);
  assert.equal(d.action, 'answer');
});
