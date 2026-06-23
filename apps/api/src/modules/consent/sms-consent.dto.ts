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
