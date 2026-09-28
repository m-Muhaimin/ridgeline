/**
 * Who is allowed to do what, in one place.
 *
 * The assistant proposes; this decides. Previously the booking gate was an
 * ad-hoc `shouldConfirmBooking` flag from the language model plus an inline
 * `wantsSlot` check, which meant a model hiccup could authorise a write. Here
 * every decision is derived from verifiable facts and is pure, so it can be
 * tested without a database, an LLM or a phone number.
 */

export type AssistantIntent = 'book' | 'reschedule' | 'cancel' | 'inquiry' | 'emergency' | 'confirm';

export type PolicyAction =
  | 'answer'
  | 'quote'
  | 'propose_slot'
  | 'confirm_booking'
  | 'reschedule'
  | 'cancel'
  | 'escalate';

export type SlotResolution = 'available' | 'unavailable' | 'unstated';

export type PolicyFacts = {
  intent: AssistantIntent;
  urgency: 'routine' | 'urgent' | 'emergency';
  /** A concrete service was matched, not a guess. */
  serviceIdentified: boolean;
  addressKnown: boolean;
  /** A time the customer stated. Never one the model chose. */
  requestedSlot: string | null;
  /** Outcome of resolving that stated time against live availability. */
  slotResolution: SlotResolution;
  /** Whether this organization allows a booking without a human in the loop. */
  autoConfirmEnabled: boolean;
  /** An existing booking exists to move or cancel. */
  hasExistingBooking: boolean;
};

export type PolicyDecision = {
  action: PolicyAction;
  reason: string;
  /** Only a true here may cause a row to be written. */
  mayWrite: boolean;
  /** A human should be looped in regardless of the action. */
  requiresHuman: boolean;
};

const NO_WRITE = (action: PolicyAction, reason: string, requiresHuman = false): PolicyDecision => ({
  action, reason, mayWrite: false, requiresHuman,
});

export function decide(facts: PolicyFacts): PolicyDecision {
  const { intent, urgency, slotResolution, requestedSlot, autoConfirmEnabled, hasExistingBooking } = facts;

  // An emergency always puts a human on notice, but it must not be blocked by
  // a missing service name: shutting a valve off is worth saying regardless.
  if (intent === 'emergency' || urgency === 'emergency') {
    if (slotResolution === 'available') {
      return { action: 'confirm_booking', reason: 'emergency with a verified opening', mayWrite: true, requiresHuman: true };
    }
    return { ...NO_WRITE('propose_slot', 'emergency: no verified opening, offering real ones'), requiresHuman: true };
  }

  if (intent === 'inquiry') {
    return NO_WRITE('answer', 'question, no schedule change');
  }

  if (intent === 'cancel') {
    if (!hasExistingBooking) {
      return NO_WRITE('answer', 'nothing on the schedule to cancel');
    }
    if (slotResolution === 'available' && !autoConfirmEnabled) {
      return NO_WRITE('cancel', 'auto-confirm disabled: a human confirms the change');
    }
    return { action: 'cancel', reason: 'customer asked to cancel an existing booking', mayWrite: true, requiresHuman: false };
  }

  if (intent === 'reschedule') {
    if (!hasExistingBooking) {
      return NO_WRITE('answer', 'asked to move a booking but none is on file');
    }
    if (slotResolution !== 'available') {
      return NO_WRITE('propose_slot', 'no verified opening for the requested move');
    }
    // The switch means "no schedule change without a human", not "no new
    // bookings without a human". Moving a job is a change to someone's day.
    if (!autoConfirmEnabled) {
      return NO_WRITE('reschedule', 'auto-confirm disabled: a human confirms the move');
    }
    return { action: 'reschedule', reason: 'stated time verified free', mayWrite: true, requiresHuman: false };
  }

  // book / confirm
  if (!requestedSlot) {
    return NO_WRITE('propose_slot', 'customer has not named a time yet');
  }
  if (slotResolution === 'unavailable') {
    return NO_WRITE('propose_slot', 'the time the customer named is taken or outside working hours');
  }
  if (slotResolution === 'unstated') {
    return NO_WRITE('propose_slot', 'stated time could not be resolved against availability');
  }
  if (!autoConfirmEnabled) {
    return NO_WRITE('propose_slot', 'auto-confirm disabled: a human confirms the booking');
  }
  return {
    action: 'confirm_booking',
    reason: 'customer stated a time and it was verified free',
    mayWrite: true,
    requiresHuman: false,
  };
}

/** Does this action write to the schedule? Kept next to `decide` so callers
 *  cannot drift into checking `action` themselves. */
export function isWriteAction(action: PolicyAction): boolean {
  return action === 'confirm_booking' || action === 'reschedule' || action === 'cancel';
}
