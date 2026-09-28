import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OPENAI_API_KEY,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  RIDGELINE_SYSTEM_PROMPT,
  callOpenAiCompatibleChat,
  runSmsAssistant,
  type SmsAssistantResult,
} from '../ai-pipeline.js';

// Every test here is hermetic: no server, no database, no network, no LLM. The
// pipeline takes its Gemini client as a dependency and calls `fetch` for the
// OpenAI-compatible tier, so both are stubbed -- either by passing
// `gemini: null` / `llmProvider: 'gemini'` to skip a tier, or by swapping
// `globalThis.fetch` for a recorder. Nothing reaches a real provider.

/** Settings that force the rule-based tier: skip OpenAI, and no Gemini client. */
const FALLBACK_SETTINGS = {
  llmProvider: 'gemini',
  businessName: 'Apex Plumbing',
  tradespersonName: 'T',
  tradeType: 'plumbing',
};

const FALLBACK_DEPS = { gemini: null };

/**
 * The assertion contract the rule-based tier actually returns.
 *
 * NOTE the two corrections against the brief's wording, which described an
 * earlier shape:
 *   - there is no `emergencyDetected` boolean. An emergency is reported through
 *     `intent` / `urgency` / `actionTag`.
 *   - `requestedSlot` is `string | null` (a time the customer named, verbatim),
 *     not an object with a `.start`.
 */
function assertResultShape(r: SmsAssistantResult): void {
  assert.equal(typeof r, 'object');
  assert.equal(typeof r.source, 'string');
  assert.ok(r.source.length > 0, 'source must be a non-empty string');
  assert.equal(typeof r.replyText, 'string');
  assert.ok(r.replyText.length > 0, 'replyText must be a non-empty string');
  assert.ok(
    ['book', 'reschedule', 'cancel', 'inquiry', 'emergency', 'confirm'].includes(r.intent),
    `unexpected intent: ${r.intent}`,
  );
  assert.ok(['routine', 'urgent', 'emergency'].includes(r.urgency), `unexpected urgency: ${r.urgency}`);
  assert.ok(
    [
      'auto_booked', 'rescheduled', 'quote_given', 'emergency_escalated',
      'slot_offered', 'info_requested',
    ].includes(r.actionTag),
    `unexpected actionTag: ${r.actionTag}`,
  );
  assert.ok(r.requestedSlot === null || typeof r.requestedSlot === 'string', 'requestedSlot must be string | null');
  // The rule-based tier always fills these; a model may legitimately return null
  // for either, which the interface allows.
  assert.ok(r.serviceTitle === null || typeof r.serviceTitle === 'string', 'serviceTitle must be string | null');
  assert.ok(r.extractedAddress === null || typeof r.extractedAddress === 'string', 'extractedAddress must be string | null');
  assert.equal(typeof r.estimatedPrice, 'number');
  assert.equal(typeof r.shouldConfirmBooking, 'boolean');
}

/** Run `fn` with `globalThis.fetch` replaced, then put the real one back. */
async function withFetch<T>(stub: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/** Capture console.warn so a deliberately-failed provider branch stays quiet. */
async function withSilencedWarn<T>(fn: () => Promise<T>): Promise<T> {
  const real = console.warn;
  const lines: string[] = [];
  console.warn = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    return await fn();
  } finally {
    console.warn = real;
  }
}

/** A Response-shaped stub: the pipeline only reads `.ok` and `.text()`. */
function jsonReply(content: string) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchStub = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
    } as any;
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchStub };
}

const BOOKING_JSON = JSON.stringify({
  replyText: 'Booked you in for 10am tomorrow.',
  intent: 'book',
  urgency: 'routine',
  actionTag: 'auto_booked',
  serviceTitle: 'Faucet install',
  requestedSlot: '2026-01-01 10:00',
  extractedAddress: '12 Ridge Ln',
  estimatedPrice: 195,
  shouldConfirmBooking: true,
});

// ---------------------------------------------------------------------------
// 1. Emergency (rule-based tier)
// ---------------------------------------------------------------------------
test('emergency: the fallback escalates and leads with the safety instruction', async () => {
  const r = await runSmsAssistant(
    { incomingText: 'water flooding in kitchen', customerName: 'C', customerPhone: '+15551234567', address: '', conversationHistory: [], existingBookings: [], services: [], settings: { ...FALLBACK_SETTINGS, emergencyKeywords: [] } },
    FALLBACK_DEPS,
  );

  assertResultShape(r);
  assert.equal(r.source, 'fallback');
  // No `emergencyDetected` field exists; intent/urgency/actionTag are the signal.
  assert.equal(r.intent, 'emergency');
  assert.equal(r.urgency, 'emergency');
  assert.equal(r.actionTag, 'emergency_escalated');
  // The reply text does NOT contain the literal word "URGENT". It leads with the
  // water-category guidance from the shared triage rule, then the tradesperson
  // name (settings.tradespersonName = 'T'), then asks for the address.
  assert.ok(r.replyText.length > 0, 'replyText must be non-empty');
  assert.match(r.replyText, /Shut off the main water valve clockwise/);
  assert.match(r.replyText, /T will get on this as fast as possible/);
  assert.equal(r.estimatedPrice, 380);
  assert.equal(r.requestedSlot, null);
});

// ---------------------------------------------------------------------------
// 2. Relative-date booking request (rule-based tier)
// ---------------------------------------------------------------------------
test('a dated booking request reaches the fallback and is NOT booked by the rule engine', async () => {
  // Built from local calendar parts, not toISOString(), so the test cannot drift
  // across a timezone boundary.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  const r = await runSmsAssistant(
    {
      incomingText: `Book me ${ymd} at 10am for a faucet install`,
      customerName: 'C',
      customerPhone: '+15551234567',
      address: '12 Ridge Ln',
      conversationHistory: [],
      existingBookings: [],
      services: [{ id: 's1', name: 'faucet install', durationMinutes: 60 }],
      settings: FALLBACK_SETTINGS,
    },
    FALLBACK_DEPS,
  );

  assertResultShape(r);
  assert.equal(r.source, 'fallback');
  // The rule engine classifies intent only. It deliberately never returns a
  // requestedSlot, even when the customer names a real date: a guessed time gets
  // written straight into the schedule, so the slot is left to the scheduling
  // engine (resolveRequestedSlot in booking-service.ts). Asserting a
  // non-null requestedSlot here would lock in the unsafe behaviour.
  assert.equal(r.requestedSlot, null);
  assert.equal(r.shouldConfirmBooking, false, 'the fallback must never claim a booking it did not make');
  assert.ok(!r.replyText.includes(ymd), 'the fallback must not invent a confirmed time in its reply');
  // The address the caller supplied is carried through for the policy engine.
  assert.equal(r.extractedAddress, '12 Ridge Ln');
});

// ---------------------------------------------------------------------------
// 3. Quote inquiry
// ---------------------------------------------------------------------------
test('a price question is answered with the diagnostic range and no slot', async () => {
  const r = await runSmsAssistant(
    {
      incomingText: 'how much for a faucet install?',
      customerName: 'C',
      customerPhone: '+15551234567',
      address: '',
      conversationHistory: [],
      existingBookings: [],
      services: [{ id: 's1', name: 'faucet install', durationMinutes: 60 }],
      settings: FALLBACK_SETTINGS,
    },
    FALLBACK_DEPS,
  );

  assertResultShape(r);
  assert.equal(r.source, 'fallback');
  assert.equal(r.intent, 'inquiry');
  assert.equal(r.actionTag, 'quote_given');
  assert.equal(r.urgency, 'routine', 'a price question must not be triaged as an emergency');
  assert.equal(r.requestedSlot, null);
  assert.ok(r.replyText.length > 0);
  assert.match(r.replyText, /\$195-\$285/);
});

// ---------------------------------------------------------------------------
// 4. Greeting
// ---------------------------------------------------------------------------
test('a bare greeting asks for the issue and the address, and books nothing', async () => {
  const r = await runSmsAssistant(
    { incomingText: 'hi', settings: FALLBACK_SETTINGS },
    FALLBACK_DEPS,
  );

  assertResultShape(r);
  assert.equal(r.source, 'fallback');
  assert.equal(r.intent, 'inquiry');
  assert.equal(r.actionTag, 'info_requested');
  assert.equal(r.urgency, 'routine');
  assert.equal(r.requestedSlot, null);
  assert.equal(r.shouldConfirmBooking, false);
  assert.match(r.replyText, /Can you share what issue you're experiencing and your address\?/);
});

// ---------------------------------------------------------------------------
// 5. Never throws
// ---------------------------------------------------------------------------
test('empty input resolves instead of throwing', async () => {
  // `llmProvider: 'gemini'` is added to the brief's settings so the provider
  // choice cannot depend on an OPENAI_COMPATIBLE_API_KEY that happens to be set
  // in the developer's shell -- without it this call would leave the process.
  await assert.doesNotReject(
    runSmsAssistant(
      {
        incomingText: '',
        customerName: 'C',
        customerPhone: '+15551234567',
        address: '',
        conversationHistory: [],
        existingBookings: [],
        services: [],
        settings: { ...FALLBACK_SETTINGS },
      },
      FALLBACK_DEPS,
    ),
  );
});

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------
test('llmProvider "gemini" skips the OpenAI-compatible tier entirely', async () => {
  const stub = jsonReply(BOOKING_JSON);
  const r = await withFetch(stub.fetch, () =>
    runSmsAssistant(
      {
        incomingText: 'book me tomorrow at 10am',
        settings: { ...FALLBACK_SETTINGS, openaiApiKey: 'sk-should-not-be-used' },
      },
      FALLBACK_DEPS,
    ),
  );

  assert.equal(stub.calls.length, 0, 'no OpenAI-compatible call may be attempted');
  assert.equal(r.source, 'fallback');
});

test('a configured openaiApiKey selects the OpenAI-compatible tier', async () => {
  const stub = jsonReply(BOOKING_JSON);
  const r = await withFetch(stub.fetch, () =>
    runSmsAssistant(
      {
        incomingText: 'book me tomorrow at 10am',
        settings: {
          llmProvider: 'openai_compatible',
          openaiBaseUrl: 'https://gateway.test/v1/',
          openaiApiKey: 'sk-test-key',
          openaiModel: 'test/model-1',
          businessName: 'Apex Plumbing',
          tradespersonName: 'T',
          tradeType: 'plumbing',
        },
        services: [{ title: 'Faucet install', basePrice: 195, durationHours: 1 }],
        existingBookings: [{ id: 'b1', customerName: 'C', date: '2026-01-01', timeSlot: '09:00-10:00', status: 'scheduled' }],
        conversationHistory: [{ sender: 'customer', text: 'the tap is dripping' }],
      },
      FALLBACK_DEPS,
    ),
  );

  assert.equal(stub.calls.length, 1);
  assert.equal(r.source, 'openai_compatible');
  assert.equal(r.model, 'test/model-1');
  assert.equal(r.replyText, 'Booked you in for 10am tomorrow.');
  // A time the MODEL returned is passed through verbatim, unparsed.
  assert.equal(r.requestedSlot, '2026-01-01 10:00');
  assertResultShape(r);
});

// ---------------------------------------------------------------------------
// OpenAI-compatible request shape
// ---------------------------------------------------------------------------
test('the OpenAI-compatible call posts the system prompt, the customer text, and json mode', async () => {
  const stub = jsonReply(BOOKING_JSON);
  await withFetch(stub.fetch, () =>
    runSmsAssistant(
      {
        incomingText: 'the kitchen tap is dripping, can someone come out?',
        customerName: 'Dana',
        customerPhone: '+15551234567',
        address: '12 Ridge Ln',
        services: [{ title: 'Faucet install', basePrice: 195, durationHours: 1 }],
        conversationHistory: [{ sender: 'customer', text: 'the tap is dripping' }],
        settings: {
          llmProvider: 'openai_compatible',
          openaiBaseUrl: 'https://gateway.test/v1/',
          openaiApiKey: 'sk-test-key',
          openaiModel: 'test/model-1',
          tradespersonName: 'T',
        },
      },
      FALLBACK_DEPS,
    ),
  );

  assert.equal(stub.calls.length, 1);
  const { url, init } = stub.calls[0];
  // The trailing slash on the configured base URL is stripped before joining.
  assert.equal(url, 'https://gateway.test/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Authorization'], 'Bearer sk-test-key');
  assert.equal(init.headers['Content-Type'], 'application/json');

  const body = JSON.parse(init.body);
  assert.equal(body.model, 'test/model-1');
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, RIDGELINE_SYSTEM_PROMPT);
  assert.equal(body.messages[1].role, 'user');
  assert.ok(body.messages[1].content.includes('the kitchen tap is dripping'), 'the customer text must reach the model');
  assert.ok(body.messages[1].content.includes('Faucet install'), 'the service catalog must reach the model');
  assert.ok(body.messages[1].content.includes('Customer: the tap is dripping'), 'history must reach the model');
  // Today's date is context the model needs to resolve "tomorrow"; computed the
  // same way the pipeline does, so the assertion cannot drift.
  assert.ok(
    body.messages[1].content.includes(`Today's Date: ${new Date().toISOString().split('T')[0]}`),
    'today\'s date must be in the prompt',
  );
});

// ---------------------------------------------------------------------------
// Fence stripping (a model that wraps its JSON in ``` fences)
// ---------------------------------------------------------------------------
test('a fenced ```json reply is unwrapped before parsing', async () => {
  const stub = jsonReply('```json\n' + BOOKING_JSON + '\n```');
  const r = await withFetch(stub.fetch, () =>
    runSmsAssistant(
      {
        incomingText: 'book me tomorrow at 10am',
        settings: { llmProvider: 'openai_compatible', openaiApiKey: 'sk-test-key', openaiModel: 'test/model-1' },
      },
      FALLBACK_DEPS,
    ),
  );

  assert.equal(r.source, 'openai_compatible');
  assert.equal(r.replyText, 'Booked you in for 10am tomorrow.', 'the fences must not survive into the parsed value');
  assertResultShape(r);
});

test('a bare ``` fence and surrounding whitespace are also stripped', async () => {
  const stub = jsonReply('\n\n   ```\n' + BOOKING_JSON + '\n```   \n');
  const r = await withFetch(stub.fetch, () =>
    runSmsAssistant(
      {
        incomingText: 'book me tomorrow at 10am',
        settings: { llmProvider: 'openai_compatible', openaiApiKey: 'sk-test-key', openaiModel: 'test/model-1' },
      },
      FALLBACK_DEPS,
    ),
  );

  assert.equal(r.source, 'openai_compatible');
  assert.equal(r.replyText, 'Booked you in for 10am tomorrow.');
});

test('prose wrapped around a fence degrades to the rule engine instead of throwing', async () => {
  // Current behaviour, locked in: stripping removes the fence markers but not
  // the prose, so JSON.parse throws inside the provider branch, the existing
  // catch logs a warning, and the pipeline falls through to the next tier.
  const stub = jsonReply('Sure! Here is the JSON:\n```json\n' + BOOKING_JSON + '\n```');
  const r = await withSilencedWarn(() =>
    withFetch(stub.fetch, () =>
      runSmsAssistant(
        {
          incomingText: 'book me tomorrow at 10am',
          settings: { llmProvider: 'openai_compatible', openaiApiKey: 'sk-test-key', openaiModel: 'test/model-1' },
        },
        FALLBACK_DEPS,
      ),
    ),
  );

  assert.equal(r.source, 'fallback');
  assertResultShape(r);
});

test('a malformed model reply degrades to the rule engine instead of throwing', async () => {
  const stub = jsonReply('{ this is not json');
  const r = await withSilencedWarn(() =>
    withFetch(stub.fetch, () =>
      runSmsAssistant(
        {
          incomingText: 'book me tomorrow at 10am',
          settings: { llmProvider: 'openai_compatible', openaiApiKey: 'sk-test-key', openaiModel: 'test/model-1' },
        },
        FALLBACK_DEPS,
      ),
    ),
  );

  assert.equal(r.source, 'fallback');
  assertResultShape(r);
});

test('a non-2xx provider response degrades to the rule engine instead of throwing', async () => {
  const failing: typeof fetch = async () =>
    ({ ok: false, status: 500, text: async () => 'upstream exploded' }) as any;
  const r = await withSilencedWarn(() =>
    withFetch(failing, () =>
      runSmsAssistant(
        {
          incomingText: 'book me tomorrow at 10am',
          settings: { llmProvider: 'openai_compatible', openaiApiKey: 'sk-test-key' },
        },
        FALLBACK_DEPS,
      ),
    ),
  );

  assert.equal(r.source, 'fallback');
  assertResultShape(r);
});

// ---------------------------------------------------------------------------
// Gemini tier
// ---------------------------------------------------------------------------
test('the injected Gemini client is used when the OpenAI-compatible tier did not answer', async () => {
  const calls: any[] = [];
  const gemini = {
    models: {
      generateContent: async (req: any) => {
        calls.push(req);
        return { text: '{"replyText":"On my way.","intent":"inquiry","urgency":"routine","actionTag":"info_requested","serviceTitle":null,"requestedSlot":null,"extractedAddress":null,"estimatedPrice":250,"shouldConfirmBooking":false}' };
      },
    },
  } as any;

  const r = await runSmsAssistant(
    {
      incomingText: 'when are you free?',
      settings: { llmProvider: 'gemini', tradespersonName: 'T' },
    },
    { gemini },
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gemini-3.8-flash');
  assert.ok(calls[0].contents.includes('when are you free?'));
  assert.equal(calls[0].config.systemInstruction, RIDGELINE_SYSTEM_PROMPT);
  assert.equal(calls[0].config.responseMimeType, 'application/json');
  assert.equal(r.source, 'gemini');
  assert.equal(r.replyText, 'On my way.');
  assertResultShape(r);
});

test('the Gemini tier is skipped when no client is injected', async () => {
  const r = await runSmsAssistant(
    { incomingText: 'when are you free?', settings: { llmProvider: 'gemini' } },
    FALLBACK_DEPS,
  );
  assert.equal(r.source, 'fallback');
});

test('a throwing Gemini client degrades to the rule engine instead of throwing', async () => {
  const gemini = {
    models: { generateContent: async () => { throw new Error('gemini 503'); } },
  } as any;

  const r = await withSilencedWarn(() =>
    runSmsAssistant({ incomingText: 'when are you free?', settings: { llmProvider: 'gemini' } }, { gemini }),
  );

  assert.equal(r.source, 'fallback');
  assertResultShape(r);
});

test('a Gemini reply that is not JSON degrades to the rule engine instead of throwing', async () => {
  const gemini = { models: { generateContent: async () => ({ text: 'not json at all' }) } } as any;
  const r = await withSilencedWarn(() =>
    runSmsAssistant({ incomingText: 'when are you free?', settings: { llmProvider: 'gemini' } }, { gemini }),
  );
  assert.equal(r.source, 'fallback');
  assertResultShape(r);
});

// ---------------------------------------------------------------------------
// callOpenAiCompatibleChat, called directly
// ---------------------------------------------------------------------------
test('callOpenAiCompatibleChat refuses to call out with an empty key', async () => {
  // No fetch stub: a call would fail loudly rather than being caught.
  await assert.rejects(
    callOpenAiCompatibleChat({
      baseUrl: 'https://gateway.test/v1',
      apiKey: '',
      systemPrompt: RIDGELINE_SYSTEM_PROMPT,
      userPrompt: 'hi',
    }),
    /OpenAI-compatible API key is not configured/,
  );
});

test('callOpenAiCompatibleChat accumulates an SSE stream', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"On my "}}]}',
    'data: {"choices":[{"delta":{"content":"way."}}]}',
    'data: [DONE]',
  ].join('\n');

  const stub: typeof fetch = async () => ({ ok: true, status: 200, text: async () => sse }) as any;
  const out = await withFetch(stub, () =>
    callOpenAiCompatibleChat({
      baseUrl: 'https://gateway.test/v1',
      apiKey: 'sk-test-key',
      model: 'test/model-1',
      systemPrompt: RIDGELINE_SYSTEM_PROMPT,
      userPrompt: 'hi',
    }),
  );

  assert.equal(out, 'On my way.');
});

test('the exported defaults come from env with the documented fallbacks', () => {
  assert.equal(typeof DEFAULT_OPENAI_BASE_URL, 'string');
  assert.ok(DEFAULT_OPENAI_BASE_URL.length > 0);
  assert.equal(typeof DEFAULT_OPENAI_API_KEY, 'string');
  assert.equal(typeof DEFAULT_OPENAI_MODEL, 'string');
  assert.equal(typeof RIDGELINE_SYSTEM_PROMPT, 'string');
  assert.ok(RIDGELINE_SYSTEM_PROMPT.includes('RidgeLine'));
});
