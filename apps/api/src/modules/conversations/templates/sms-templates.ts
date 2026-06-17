/**
 * Outbound SMS bodies (CLAUDE.md §9.6 — no inline SMS strings; every body the
 * platform sends a caller or operator originates here). Pure functions, no DI,
 * so they're trivially unit-testable and importable from controllers, services,
 * and AI tool handlers alike. Caller-facing unless noted. Keep each body within
 * ~1 SMS segment where practical.
 */

/**
 * A2P/CTIA opt-out disclosure required on the FIRST message of a conversation
 * (PROGRESS.md Slice 16). Twilio enforces STOP/UNSTOP automatically; this is the
 * human-readable disclosure.
 */
const STOP_DISCLOSURE = 'Reply STOP to opt out. Msg & data rates may apply.';

/** Opening SMS sent after the voice greeting — carries the opt-out disclosure. */
export function openingSms(businessName: string): string {
  return (
    `Hi! Thanks for calling ${businessName}. What can we help with today? ` +
    `Reply here and we'll get you on the schedule. ${STOP_DISCLOSURE}`
  );
}

/** Optional booking-fee line appended to the confirmation when a fee is due. */
export function bookingFeeLine(feeCents: number, checkoutUrl: string): string {
  return ` Please secure your slot with the $${(feeCents / 100).toFixed(2)} booking fee: ${checkoutUrl}`;
}

/** Booking confirmation to the caller. `feeLine` is appended verbatim (may be empty). */
export function bookingConfirmationSms(args: {
  businessName: string;
  friendlyTime: string;
  icsUrl: string;
  feeLine?: string;
}): string {
  return (
    `✅ You're booked with ${args.businessName} for ${args.friendlyTime}. ` +
    `Add to your calendar: ${args.icsUrl}` +
    (args.feeLine ?? '')
  );
}

/**
 * Stable substring present in the degraded-mode handoff, used to dedupe re-sends
 * (AdvanceService queries messages for this marker). Keep in sync with
 * `degradedHandoffSms`.
 */
export const DEGRADED_HANDOFF_MARKER = "can't book online right now";

/** Past-due / not-in-good-standing degraded handoff (CLAUDE.md §9.5 Flow A). */
export function degradedHandoffSms(businessName: string): string {
  return (
    `Thanks for reaching ${businessName}! We ${DEGRADED_HANDOFF_MARKER}, ` +
    'but we have your number and will follow up with you as soon as possible.'
  );
}

/** Booking-fee payment link, sent by the request_payment_link tool. */
export function paymentLinkSms(checkoutUrl: string): string {
  return `Reserve your slot with the booking fee here: ${checkoutUrl}`;
}

/** Out-of-scope handoff — the caller's address is outside the service area. */
export function outOfScopeAreaSms(businessName: string, zipList: string): string {
  return `Thanks for reaching out! ${businessName} only services ZIP codes ${zipList}. Your address is outside our area — best of luck finding a local pro.`;
}

/** Out-of-scope handoff — the job type isn't something this trade handles. */
export function outOfScopeServiceSms(businessName: string, services: string): string {
  return `Thanks for reaching out! ${businessName} handles ${services}. What you described is outside that — we're not the right fit, but best of luck finding the right pro.`;
}

/** Out-of-scope handoff — generic (no ZIPs and no service list available). */
export function outOfScopeGenericSms(businessName: string): string {
  return `Thanks for reaching out — what you described is outside what ${businessName} handles. Best of luck finding the right pro.`;
}

/** Sent to the caller when the bot escalates to a human. */
export function escalationHandoffSms(): string {
  return "I've passed your message to the team — someone will reach out shortly.";
}

/** Emergency alert to the OPERATOR's personal phone (operator-facing, not the caller). */
export function emergencyAlertSms(args: {
  businessName: string;
  callerLast4: string;
  reason: string;
  callerFrom: string;
}): string {
  return (
    `🚨 EMERGENCY CALL — ${args.businessName}\n` +
    `Caller •••${args.callerLast4} reports: ${args.reason}.\n` +
    `Call them back: ${args.callerFrom}\n` +
    `(KeeprSteady AI is also responding to keep them engaged until you do.)`
  );
}

/** 1-hour-before appointment reminder to the caller (CLAUDE.md §9.6). */
export function appointmentReminderSms(businessName: string, friendlyTime: string): string {
  return (
    `Reminder: your appointment with ${businessName} is coming up at ${friendlyTime}. ` +
    `Reply here if you need to reschedule.`
  );
}
