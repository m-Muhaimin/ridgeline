import { GoogleGenAI, Type } from '@google/genai';
import { detectEmergency } from '../domain/safety/triage.js';

// System instruction for RidgeLine Trade Assistant
export const RIDGELINE_SYSTEM_PROMPT = `You are "RidgeLine", an intelligent SMS scheduling and dispatch assistant representing a solo licensed tradesperson (plumber, electrician, or HVAC technician).
The tradesperson is actively on tools (under a sink, in an attic, or in a trench) and cannot text or answer calls.

Your job:
1. Handle incoming customer SMS text messages warmly, concisely, and decisively. Sound like a helpful human assistant or the owner's dedicated dispatcher (not a robotic corporate chatbot).
2. Triage urgency:
   - "emergency": Active flooding, sewage backup, carbon monoxide, no heat in winter, sparking electrical. Advise immediate safety steps (e.g. "please shut off the main water valve clockwise") and prioritize immediate scheduling.
   - "urgent": Major inconvenience (e.g., sole toilet clogged, water heater pilot out).
   - "routine": Maintenance, faucet replacements, EV chargers, quotes.
3. Handle bookings:
   - Identify service needed and match with service catalog.
   - Propose 1-2 concrete time slots.
   - Collect address if not provided.
   - Auto-confirm when client agrees to a slot.
4. Handle reschedules:
   - Parse natural language reschedule requests (e.g. "push to Thursday morning", "can we do 4pm instead?").
   - Offer the new slot and confirm update.
5. Tone: Short, helpful text messages (1 to 3 sentences max, suitable for SMS). Keep sentences crisp. Never write long multi-paragraph essays.`;

// Default OpenAI-compatible endpoint settings (e.g. LiteLLM, vLLM, Ollama).
// Env-driven, and the fallback is deliberately the RFC 2606 `.invalid` TLD,
// which is guaranteed never to resolve. It must NOT be a real host: a hardcoded
// default silently ships every LLM call to a third party for any deployment
// that forgot to set the var. Because the fallback is always a non-empty string,
// "no URL configured" is unrepresentable, and the tier is gated on the API key
// in `callOpenAiCompatibleChat` - so this placeholder can never be dialled with
// a real key unless OPENAI_COMPATIBLE_BASE_URL is set.
export const DEFAULT_OPENAI_BASE_URL = process.env.OPENAI_COMPATIBLE_BASE_URL || 'https://openai-compatible.invalid/v1';
// Empty-string (not undefined) so the truthiness-based provider-selection chain
// below degrades cleanly to Gemini and then the deterministic responder when
// OPENAI_COMPATIBLE_API_KEY is unset, instead of attempting a request with a
// missing key.
export const DEFAULT_OPENAI_API_KEY = process.env.OPENAI_COMPATIBLE_API_KEY || '';
export const DEFAULT_OPENAI_MODEL = process.env.OPENAI_COMPATIBLE_MODEL || 'gemini/gemini-3.8-flash';

// Helper to call OpenAI-compatible chat completions endpoint with json output
export async function callOpenAiCompatibleChat(options: {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
}): Promise<string> {
  const baseUrl = (options.baseUrl || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const apiKey = options.apiKey || DEFAULT_OPENAI_API_KEY;
  const model = options.model || DEFAULT_OPENAI_MODEL;

  // Refuse to call out with an empty bearer token. `llmProvider` is hydrated as
  // 'openai_compatible' by default (see assistant_settings load), so this branch
  // is reachable with no key configured; sending `Authorization: Bearer ` would
  // spend a doomed round-trip on a guaranteed 401. Throwing lets the caller's
  // existing catch hand off to Gemini and then the deterministic responder.
  if (!apiKey) {
    throw new Error('OpenAI-compatible API key is not configured');
  }

  const url = `${baseUrl}/chat/completions`;
  const body: any = {
    model,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
    temperature: 0.2,
  };

  if (options.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI-compatible API error (${response.status}): ${errText}`);
  }

  const text = await response.text();

  // Handle both standard JSON responses and SSE streams if returned
  try {
    const json = JSON.parse(text);
    return json.choices?.[0]?.message?.content || '';
  } catch (e) {
    // Check if response is Server-Sent Events (data: {...})
    if (text.includes('data:')) {
      let accumulatedContent = '';
      const lines = text.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
          const chunkStr = trimmed.slice(5).trim();
          try {
            const chunk = JSON.parse(chunkStr);
            const delta = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || '';
            accumulatedContent += delta;
          } catch (err) {
            // continue
          }
        }
      }
      if (accumulatedContent) return accumulatedContent;
    }
    return text;
  }
}

export interface RunSmsAssistantOptions {
  incomingText: string;
  customerName?: string;
  customerPhone?: string;
  address?: string;
  conversationHistory?: Array<{ sender: string; text: string }>;
  existingBookings?: any[];
  services?: any[];
  settings?: any;
}

export interface SmsAssistantResult {
  source: string;
  replyText: string;
  intent: 'book' | 'reschedule' | 'cancel' | 'inquiry' | 'emergency' | 'confirm';
  urgency: 'routine' | 'urgent' | 'emergency';
  actionTag: 'auto_booked' | 'rescheduled' | 'quote_given' | 'emergency_escalated' | 'slot_offered' | 'info_requested';
  serviceTitle: string | null;
  /**
   * A time the CUSTOMER asked for, verbatim, or null. Never a time the model
   * chose: a proposed clock time is a scheduling decision, and those come
   * from business hours plus live bookings, not from a language model.
   */
  requestedSlot: string | null;
  extractedAddress: string | null;
  estimatedPrice: number;
  shouldConfirmBooking: boolean;
  model?: string;
}

// Shared SMS Assistant Pipeline (OpenAI-compatible -> Gemini -> Rule-based fallback)
export async function runSmsAssistant(
  options: RunSmsAssistantOptions,
  deps: { gemini: GoogleGenAI | null },
): Promise<SmsAssistantResult> {
  const {
    incomingText,
    customerName,
    customerPhone,
    address,
    conversationHistory = [],
    existingBookings = [],
    services = [],
    settings = {},
  } = options;

  let parsedResult: any = null;

  const prompt = `
Context:
- Business: ${settings.businessName || 'Apex Trades'}
- Tradesperson: ${settings.tradespersonName || 'Mark'} (${settings.tradeType || 'plumbing'})
- Customer Name: ${customerName || 'Customer'}
- Customer Phone: ${customerPhone || 'Unknown'}
- Known Customer Address: ${address || 'Not yet provided'}
- Today's Date: ${new Date().toISOString().split('T')[0]}
- Available Services: ${JSON.stringify(services.map((s: any) => ({ title: s.title, price: s.basePrice, durationHours: s.durationHours })))}
- Recent Bookings: ${JSON.stringify(existingBookings.map((b: any) => ({ id: b.id, name: b.customerName, date: b.date, slot: b.timeSlot, status: b.status })))}

Conversation history so far:
${conversationHistory.map((m: any) => `${m.sender === 'customer' ? 'Customer' : 'Assistant'}: ${m.text}`).join('\n')}

New incoming SMS from customer:
"${incomingText}"

Analyze this message, determine the intent, formulate the optimal SMS response, and extract structured data.
You MUST return a JSON object with the following schema:
{
  "replyText": "exact SMS text string under 300 characters, friendly and direct",
  "intent": "book" | "reschedule" | "cancel" | "inquiry" | "emergency" | "confirm",
  "urgency": "routine" | "urgent" | "emergency",
  "actionTag": "auto_booked" | "rescheduled" | "quote_given" | "emergency_escalated" | "slot_offered" | "info_requested",
  "serviceTitle": "matched service title or null",
  "requestedSlot": "a time the CUSTOMER explicitly asked for, copied verbatim, or null. NEVER invent, guess or infer a time that was not stated.",
  "extractedAddress": "address extracted from message if any or null",
  "estimatedPrice": number,
  "shouldConfirmBooking": boolean (true if slot explicitly confirmed/booked/rescheduled)
}`;

  const preferredProvider = settings.llmProvider || (settings.openaiApiKey || DEFAULT_OPENAI_API_KEY ? 'openai_compatible' : 'gemini');

  if (preferredProvider === 'openai_compatible') {
    try {
      const rawContent = await callOpenAiCompatibleChat({
        baseUrl: settings.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL,
        apiKey: settings.openaiApiKey || DEFAULT_OPENAI_API_KEY,
        model: settings.openaiModel || DEFAULT_OPENAI_MODEL,
        systemPrompt: RIDGELINE_SYSTEM_PROMPT,
        userPrompt: prompt,
        jsonMode: true,
      });

      const cleaned = rawContent.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      parsedResult = JSON.parse(cleaned);
      parsedResult.source = 'openai_compatible';
      parsedResult.model = settings.openaiModel || DEFAULT_OPENAI_MODEL;
    } catch (openAiErr: any) {
      console.warn('OpenAI-compatible call failed, falling back:', openAiErr.message);
    }
  }

  // Secondary fallback: Gemini SDK if available
  if (!parsedResult && deps.gemini) {
    try {
      const response = await deps.gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction: RIDGELINE_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              replyText: {
                type: Type.STRING,
                description: 'The exact SMS text message to send back to the customer (keep under 300 characters, friendly and direct).',
              },
              intent: {
                type: Type.STRING,
                enum: ['book', 'reschedule', 'cancel', 'inquiry', 'emergency', 'confirm'],
                description: 'Primary customer intent',
              },
              urgency: {
                type: Type.STRING,
                enum: ['routine', 'urgent', 'emergency'],
                description: 'Urgency tier of the job',
              },
              actionTag: {
                type: Type.STRING,
                enum: ['auto_booked', 'rescheduled', 'quote_given', 'emergency_escalated', 'slot_offered', 'info_requested'],
                description: 'Action taken by the assistant',
              },
              serviceTitle: {
                type: Type.STRING,
                description: 'Matched trade service title, if determined.',
              },
              requestedSlot: {
                type: Type.STRING,
                description: 'A time the customer explicitly asked for, copied verbatim, or null. Never invent a time.',
              },
              extractedAddress: {
                type: Type.STRING,
                description: 'Address extracted from text if provided.',
              },
              estimatedPrice: {
                type: Type.NUMBER,
                description: 'Estimated dollar cost based on service catalog, or 0 if unknown.',
              },
              shouldConfirmBooking: {
                type: Type.BOOLEAN,
                description: 'True if a new booking or slot was explicitly agreed upon and should be added/updated in the schedule.',
              },
            },
            required: ['replyText', 'intent', 'urgency', 'actionTag', 'shouldConfirmBooking'],
          },
        },
      });

      parsedResult = JSON.parse(response.text?.trim() || '{}');
      parsedResult.source = 'gemini';
    } catch (geminiErr: any) {
      console.warn('Gemini call failed, falling back to rule-based engine:', geminiErr.message);
    }
  }

  if (!parsedResult) {
    // Deterministic rule-based fallback
    const lower = incomingText.toLowerCase();
    let intent: 'book' | 'reschedule' | 'cancel' | 'inquiry' | 'emergency' | 'confirm' = 'inquiry';
    let urgency: 'routine' | 'urgent' | 'emergency' = 'routine';
    let actionTag: 'auto_booked' | 'rescheduled' | 'quote_given' | 'emergency_escalated' | 'slot_offered' | 'info_requested' = 'info_requested';
    const techName = settings.tradespersonName || 'Mark';
    let replyText = `Thanks for reaching out! ${techName} is on a service call. Can you share what issue you're experiencing and your address?`;
    let shouldConfirmBooking = false;
    // The rule engine classifies intent only. It has no reliable way to tell
    // whether a customer named a time, and a guessed one gets written straight
    // into the schedule, so it defers to the scheduling engine.
    let requestedSlot: string | null = null;
    let estimatedPrice = 250;
    let serviceTitle = 'General Service Diagnostic';

    // One triage rule, shared with the browser. It reads the organization's own
    // emergency keywords and answers with the right safety instruction: a gas
    // leak is told to leave, not to go hunting for a valve.
    const triage = detectEmergency(incomingText, settings.emergencyKeywords);
    if (triage.isEmergency) {
      intent = 'emergency';
      urgency = 'emergency';
      actionTag = 'emergency_escalated';
      replyText = `${triage.guidance} ${techName} will get on this as fast as possible - what is your street address?`;
      estimatedPrice = 380;
      serviceTitle = 'Emergency Burst Pipe & Valve Shutoff';
    } else if (lower.includes('reschedule') || lower.includes('push to') || lower.includes('move to') || lower.includes('another day') || lower.includes('can we do')) {
      intent = 'reschedule';
      urgency = 'routine';
      // Offering is not rescheduling. The move happens once the customer
      // names a real opening, not one the fallback made up.
      actionTag = 'slot_offered';
      shouldConfirmBooking = false;
      replyText = `No problem at all, I can move that. ${techName} has a few openings - which one works for you?`;
    } else if (lower.includes('yes') || lower.includes('sounds good') || lower.includes('perfect') || lower.includes('confirm') || lower.includes('book it')) {
      intent = 'confirm';
      // "Yes" confirms the last thing offered, not a time invented here.
      actionTag = 'slot_offered';
      shouldConfirmBooking = false;
      replyText = `Great - tell me which time works and I'll lock it in on ${techName}'s schedule.`;
    } else if (lower.includes('how much') || lower.includes('cost') || lower.includes('quote') || lower.includes('price')) {
      intent = 'inquiry';
      actionTag = 'quote_given';
      replyText = `Our standard diagnostic & basic service call is $195-$285 depending on parts required. Want me to check ${techName}'s openings for you?`;
    }

    parsedResult = {
      source: 'fallback',
      replyText,
      intent,
      urgency,
      actionTag,
      serviceTitle,
      requestedSlot,
      extractedAddress: address || '',
      estimatedPrice,
      shouldConfirmBooking,
    };
  }

  return parsedResult;
}
