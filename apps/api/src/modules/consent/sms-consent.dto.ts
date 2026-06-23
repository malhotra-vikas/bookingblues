import { z } from 'zod';

/**
 * Canonical SMS opt-in disclosure. The public web form at
 * apps/web/app/(marketing)/messaging/opt-in/OptInForm.tsx shows this text
 * verbatim; the API stores it on every consent row so we keep durable proof of
 * the exact wording the user agreed to. Keep the on-page copy in sync, and bump
 * CONSENT_VERSION whenever the wording materially changes (old rows retain the
 * version they were captured under).
 */
export const CONSENT_VERSION = 'sms-consent-2026-06-22';
export const CONSENT_TEXT =
  'I agree to receive recurring automated text messages from KeeprSteady about ' +
  'scheduling my service appointment. Message frequency varies. Message and data ' +
  'rates may apply. Reply STOP to opt out, HELP for help.';

/**
 * Verbal opt-in disclosure spoken on the inbound call (Polly TTS) before any
 * SMS is sent. The caller affirms by pressing 1 or saying "yes"; only then do
 * we text. The voice controller builds the spoken `<Say>` from this exact
 * string (substituting the business name) AND stores it as the consent proof,
 * so what we say, what we store, and what we submit to the carrier are one
 * source of truth. `[business name]` is substituted at call time.
 */
export const VOICE_CONSENT_VERSION = 'voice-ivr-2026-06-23';
export const VOICE_CONSENT_TEXT =
  'Thanks for calling [business name]. They are with another customer right now. ' +
  'We can send you a text message to help get you scheduled. Message and data rates ' +
  'may apply. Reply STOP to opt out, or HELP for help, at any time. ' +
  'To get that text now, press 1, or say yes.';

export const SmsOptInSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Raw user input — normalized to E.164 server-side via libphonenumber-js.
  phone: z.string().trim().min(7).max(20),
  trade: z.string().trim().max(120).optional(),
  // Must be checked. The page disables submit until it is; this is the backstop
  // for assistive tech / form-fill tools that bypass the disabled state.
  consent: z.literal(true),
});

export type SmsOptInDto = z.infer<typeof SmsOptInSchema>;
