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
/**
 * Ordering note (2026-07-16): the ask leads, the disclosure follows. The prior
 * wording buried "press 1" ~18 seconds in, behind the rates/STOP/HELP block —
 * Twilio call logs showed real callers hanging up mid-disclosure, and even the
 * ones who sat through it pressed nothing, so every real missed call was
 * declined. Every required element is still spoken before we text; only the
 * order changed. `<Gather>` barge-in means a caller can press 1 as soon as they
 * hear the ask, so the disclosure may be cut short on the call — the opening
 * SMS itself repeats it (`STOP_DISCLOSURE` in openingSms), which is the
 * CTIA-required placement.
 */
export const VOICE_CONSENT_VERSION = 'voice-ivr-2026-07-16';
export const VOICE_CONSENT_TEXT =
  'Thanks for calling [business name]. Sorry we missed you! To get a text right ' +
  'now so we can get you scheduled, press 1, or say yes. Message and data rates ' +
  'may apply. Reply STOP to opt out, or HELP for help, at any time. ' +
  'Press 1, or say yes, to get your text now.';

/**
 * Spoken once when the first <Gather> comes back empty. A single retry converts
 * the caller who was still deciding; without it one silent beat ended the call
 * with "we will not text you".
 */
export const VOICE_CONSENT_REPROMPT_TEXT =
  'Still there? Press 1, or say yes, and we will text you right now to get you scheduled.';

export const SmsOptInSchema = z.object({
  name: z.string().trim().min(1).max(120),
  // Raw user input — normalized to E.164 server-side via libphonenumber-js.
  phone: z.string().trim().min(7).max(20),
  trade: z.string().trim().max(120).optional(),
  // Optional by design. Carrier/CTIA rule: SMS consent must NOT be a condition
  // of completing the form, so we accept either value. We only persist a
  // consent record (and ever text the user) when this is true.
  consent: z.boolean(),
});

export type SmsOptInDto = z.infer<typeof SmsOptInSchema>;
