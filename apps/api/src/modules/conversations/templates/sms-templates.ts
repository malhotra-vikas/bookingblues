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

/**
 * Opening SMS sent after the voice greeting — carries the opt-out disclosure.
 * Insurance gets its own wording: the trades' "get you on the schedule" read as
 * generic, and naming the common reasons gets a useful first reply instead of
 * "I need to know more about insurance" (live test 2026-11-04).
 */
export function openingSms(businessName: string, category?: string | null): string {
  if (category === 'insurance') {
    return (
      `Hi, this is ${businessName} — sorry we missed your call! Are you looking at Medicare ` +
      `or another plan, reviewing your current coverage, or have a question? Reply here and ` +
      `we'll set up a time with one of our agents. ${STOP_DISCLOSURE}`
    );
  }
  return (
    `Hi! Thanks for calling ${businessName}. What can we help with today? ` +
    `Reply here and we'll get you on the schedule. ${STOP_DISCLOSURE}`
  );
}

/**
 * Opening SMS for a missed call from someone who already has an upcoming
 * appointment: name it and ask whether this is about it (reschedule / change)
 * or something new, instead of starting a fresh intake. Carries the opt-out
 * disclosure (first message of the conversation). `when` = "Tue, Nov 10, 9:00 AM".
 */
export function returningCallerOpeningSms(businessName: string, when: string): string {
  return (
    `Hi, this is ${businessName} — sorry we missed your call! We see your appointment on ${when}. ` +
    `Is this about that appointment (to reschedule or change something), or something new? ` +
    `Just reply here. ${STOP_DISCLOSURE}`
  );
}

/**
 * What the caller is actually charged at Checkout, itemised. The platform fee
 * is charged ON TOP of the deposit, so quoting only the deposit made the SMS
 * disagree with the Checkout page (E2E test 2026-10-28: "$10.00" vs $11.50).
 */
export interface FeeCharge {
  readonly totalCents: number;
  readonly depositCents: number;
  /** Emergency visit fee included in the charge (0 when not an emergency). */
  readonly emergencyFeeCents: number;
  readonly serviceFeeCents: number;
}

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** "$11.50 ($10.00 deposit + $1.50 service fee)" */
export function describeFeeCharge(c: FeeCharge): string {
  const parts = [`${usd(c.depositCents)} deposit`];
  if (c.emergencyFeeCents > 0) parts.push(`${usd(c.emergencyFeeCents)} emergency fee`);
  parts.push(`${usd(c.serviceFeeCents)} service fee`);
  return `${usd(c.totalCents)} (${parts.join(' + ')})`;
}

/** Optional booking-fee line appended to the confirmation when a fee is due. */
export function bookingFeeLine(charge: FeeCharge, checkoutUrl: string): string {
  return ` Please secure your slot with the ${describeFeeCharge(charge)} booking fee: ${checkoutUrl}`;
}

/** First name only — keeps SMS personal without echoing a full legal name. */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * What the caller should bring, per category. Sent by default (confirmation +
 * 24h reminder) so the caller arrives prepared without having to ask, and fed
 * into the AI prompt so its answer to "what should I bring?" matches the SMS.
 * Null = the category has nothing to bring (field-service trades).
 */
const BRING_LISTS: Readonly<Record<string, { list: string; note?: string }>> = {
  insurance: {
    // The MBI is on the Medicare card: the caller BRINGS it to the appointment.
    // The bot must never collect it by text (CLAUDE.md §16), hence the note.
    list:
      'your Medicare card (it shows your Medicare number/MBI), a photo ID, your current ' +
      'plan card and any plan letters (like the Annual Notice of Change), a list of your ' +
      "medications or the bottles, your doctors' and pharmacy names, and any Medicaid or " +
      'Extra Help letters',
    note: "For your privacy, please don't text us your Medicare number — just bring the card.",
  },
};

export function bringListFor(category: string | null | undefined): string | null {
  return (category && BRING_LISTS[category]?.list) || null;
}

/**
 * " Please bring …." (+ privacy note) — empty string when the category has no
 * bring-list. For a phone appointment it's what to have handy for the call.
 */
export function bringListLine(
  category: string | null | undefined,
  opts: { forCall?: boolean } = {},
): string {
  const entry = category ? BRING_LISTS[category] : undefined;
  if (!entry) return '';
  if (opts.forCall) {
    return (
      ` For the call, please have handy ${entry.list}.` +
      (entry.note ? " For your privacy, please don't text us your Medicare number." : '')
    );
  }
  return ` Please bring ${entry.list}.` + (entry.note ? ` ${entry.note}` : '');
}

/**
 * Office appointments (insurance) are phone calls: the business calls the
 * caller anytime between the appointment's start and end, so the texts give the
 * whole window, not just a start time.
 */
export interface CallWindow {
  /** "Tue, Nov 10" */
  readonly day: string;
  /** "9:00 AM" */
  readonly from: string;
  /** "10:00 AM" */
  readonly to: string;
}

export function callWindowFor(startIso: string, endIso: string, timeZone: string): CallWindow {
  const time = (iso: string): string =>
    new Date(iso).toLocaleString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  return {
    day: new Date(startIso).toLocaleString('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }),
    from: time(startIso),
    to: time(endIso),
  };
}

/** "Tue, Nov 10, anytime between 9:00 AM and 10:00 AM" */
export function describeCallWindow(w: CallWindow): string {
  return `${w.day}, anytime between ${w.from} and ${w.to}`;
}

function callWindowSentence(businessName: string, w: CallWindow): string {
  return ` ${businessName} will call you at this number on ${describeCallWindow(w)}.`;
}

/** Booking confirmation to the caller. `feeLine` is appended verbatim (may be empty). */
export function bookingConfirmationSms(args: {
  businessName: string;
  friendlyTime: string;
  icsUrl: string;
  feeLine?: string;
  callerName?: string | null;
  /** When true, ask the caller for their full property address (post-confirm). */
  askAddress?: boolean;
  /** Operator category — adds the "Please bring …" line where one is defined. */
  category?: string | null;
  /** Phone appointments (office categories): the window the business will call in. */
  callWindow?: CallWindow;
}): string {
  const fn = firstName(args.callerName);
  const lead = fn ? `✅ ${fn}, you're booked` : `✅ You're booked`;
  const addressAsk = args.askAddress
    ? ' What is the full property address (street, unit, city, ZIP) so our tech can find you?'
    : '';
  if (args.callWindow) {
    return (
      `${lead} with ${args.businessName}.` +
      callWindowSentence(args.businessName, args.callWindow) +
      bringListLine(args.category, { forCall: true }) +
      ` Add to your calendar: ${args.icsUrl}` +
      (args.feeLine ?? '')
    );
  }
  return (
    `${lead} with ${args.businessName} for ${args.friendlyTime}.` +
    bringListLine(args.category) +
    ` Add to your calendar: ${args.icsUrl}` +
    (args.feeLine ?? '') +
    addressAsk
  );
}

/** The caller's existing appointment was MOVED (not a second booking). */
export function rescheduleConfirmationSms(args: {
  businessName: string;
  friendlyTime: string;
  icsUrl: string;
  callerName?: string | null;
  category?: string | null;
  /** Phone appointments (office categories): the window the business will call in. */
  callWindow?: CallWindow;
}): string {
  const fn = firstName(args.callerName);
  const lead = fn ? `✅ ${fn}, your appointment` : '✅ Your appointment';
  if (args.callWindow) {
    return (
      `${lead} with ${args.businessName} has been moved.` +
      callWindowSentence(args.businessName, args.callWindow) +
      ` Your earlier time is cancelled.` +
      bringListLine(args.category, { forCall: true }) +
      ` Updated calendar link: ${args.icsUrl}`
    );
  }
  return (
    `${lead} with ${args.businessName} has been moved to ${args.friendlyTime}. ` +
    `Your earlier time is cancelled.` +
    bringListLine(args.category) +
    ` Updated calendar link: ${args.icsUrl}`
  );
}

/** Final acknowledgement after the caller provides their property address. */
export function addressConfirmedSms(friendlyTime: string): string {
  return `Perfect — got your address. You're all set for ${friendlyTime}. See you then!`;
}

/** Acknowledgement when the caller adds extra access notes after the address. */
export function addressNoteAddedSms(): string {
  return `Got it — I've added that to your appointment notes for the tech.`;
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

/**
 * Plan usage limit reached (Solo) for a NEW caller: replaces the opening SMS
 * after the voice greeting. First message in the conversation, so it carries
 * the opt-out disclosure; contains the degraded marker so the advance loop
 * doesn't send a second handoff if they reply.
 */
export function usageLimitOpeningSms(businessName: string): string {
  return `${degradedHandoffSms(businessName)} ${STOP_DISCLOSURE}`;
}

/**
 * Stable substring in the AI-unavailable fallback, used to dedupe re-sends so a
 * caller texting repeatedly during an OpenAI outage gets ONE fallback, not many.
 * Keep in sync with `aiUnavailableFallbackSms`.
 */
export const AI_UNAVAILABLE_MARKER = 'someone will text you back shortly';

/**
 * Fallback sent when the AI advance fails (e.g. OpenAI error/outage) so the
 * caller is never left in silence. The team is alerted in the #convos thread to
 * follow up manually.
 */
export function aiUnavailableFallbackSms(businessName: string): string {
  return (
    `Thanks for contacting ${businessName}! We've got your message and ` +
    `${AI_UNAVAILABLE_MARKER}.`
  );
}

/** Booking-fee payment link, sent by the request_payment_link tool. */
export function paymentLinkSms(checkoutUrl: string, charge?: FeeCharge): string {
  if (!charge) return `Reserve your slot with the booking fee here: ${checkoutUrl}`;
  return `Reserve your slot by paying ${describeFeeCharge(charge)} here: ${checkoutUrl}`;
}

/**
 * Sent when a fee-required slot is HELD pending payment (Reserve→Pay→Confirm).
 * The slot is not confirmed until the deposit is paid; a single self-contained
 * message so the link is never split across SMS (carrier filtering / §9.3 rate
 * limit). The hold auto-expires if unpaid.
 */
export function reservationHoldSms(args: {
  businessName: string;
  friendlyTime: string;
  charge: FeeCharge;
  checkoutUrl: string;
  callerName?: string | null;
}): string {
  const fn = firstName(args.callerName);
  const lead = fn ? `Almost done, ${fn}!` : 'Almost done!';
  return (
    `${lead} Your ${args.friendlyTime} slot with ${args.businessName} is held for 30 min. ` +
    `Pay ${describeFeeCharge(args.charge)} to confirm it: ${args.checkoutUrl}`
  );
}

/** Sent when a held (unpaid) reservation expires and the slot is released. */
export function holdExpiredSms(businessName: string, friendlyTime: string): string {
  return (
    `Your held ${friendlyTime} slot with ${businessName} expired since the booking fee wasn't paid. ` +
    `Reply here and we'll find you another time.`
  );
}

/** Out-of-scope handoff — the caller's address is outside the service area. */
export function outOfScopeAreaSms(businessName: string, areaText: string): string {
  return `Thanks for reaching out! ${businessName} services ${areaText}. Your address is outside that area — best of luck finding a local pro.`;
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

/** Pretty-print a US E.164 number for SMS, e.g. +14155551234 → (415) 555-1234. */
export function formatUsPhone(e164: string | null | undefined): string {
  const m = (e164 ?? '').match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? '');
}

/**
 * Appointment reminder to the caller (CLAUDE.md §9.6).
 *
 * Invites a reply for changes: the bot sees the caller's upcoming appointment
 * (UPCOMING APPOINTMENTS in the prompt), moves it with reschedule_appointment,
 * and hands cancellations to the team. The operator's registered business
 * number stays as an alternative.
 */
export function appointmentReminderSms(
  businessName: string,
  friendlyTime: string,
  operatorPhoneE164?: string | null,
  category?: string | null,
  /** Phone appointments (office categories): the window the business will call in. */
  callWindow?: CallWindow,
): string {
  const base = callWindow
    ? `Reminder: ${businessName} will call you at this number on ${describeCallWindow(callWindow)}.` +
      bringListLine(category, { forCall: true })
    : `Reminder: your appointment with ${businessName} is coming up at ${friendlyTime}.` +
      bringListLine(category);
  // The bot reschedules by text (and hands cancellations to the team), so
  // replying works; the business number stays as an alternative. The reply is
  // asked for as a SENTENCE: a bare "Cancel" (like STOP, END, QUIT) is a
  // carrier opt-out keyword, so Twilio would unsubscribe the caller from every
  // text from this number and the bot would never see it.
  const phone = formatUsPhone(operatorPhoneE164);
  const reply =
    ` Need to reschedule or cancel? Reply with a short message, like "Can we move it to Friday?" ` +
    `or "I need to cancel my appointment"`;
  const change = phone ? `${reply}, or call ${businessName} at ${phone}.` : `${reply}.`;
  return base + change;
}
