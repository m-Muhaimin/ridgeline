-- Webhook idempotency
-- Twilio webhooks retry until they receive a 2xx, so a retried delivery must
-- never re-run the LLM, re-insert messages, or double-book. MessageSid rows
-- are kept distinct from CallSid rows; a NULL sid (API-originated messages)
-- must not collide with anything.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_messages_twilio_message_sid
  ON public.sms_messages (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_missed_calls_twilio_call_sid
  ON public.missed_calls (twilio_call_sid)
  WHERE twilio_call_sid IS NOT NULL;
