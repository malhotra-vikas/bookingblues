import { AppError, NotFoundError } from '../../common/errors/app-error';
import type { HandoffEmailContent } from '../slack/handoff-emails';

/** Which booking step failed (see escalateFailedBooking in tool-handlers.ts). */
export type BookingFailureStage = 'book' | 'reserve' | 'fee_checkout' | 'reschedule';

export type BookingFailureKind =
  | 'calendar_permissions'
  | 'calendar_disconnected'
  | 'calendar_error'
  | 'payment_link'
  | 'internal';

/** Classify a booking error into a cause a non-technical teammate can act on. */
export function classifyBookingFailure(stage: BookingFailureStage, err: unknown): BookingFailureKind {
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = err instanceof AppError ? err.code : '';
  const google = code === 'external.google';

  if (google && /\b403\b/.test(message) && /(insufficient|scope|permission)/.test(message)) {
    return 'calendar_permissions';
  }
  if (
    /revoked|invalid_grant/.test(message) ||
    (err instanceof NotFoundError && message.includes('calendar connection'))
  ) {
    return 'calendar_disconnected';
  }
  if (google) return 'calendar_error';
  if (stage === 'fee_checkout' || code === 'external.stripe') return 'payment_link';
  return 'internal';
}

/**
 * One plain sentence on why a calendar insert failed, for Slack notes on a
 * manual booking that was saved anyway (calendarOptional).
 */
export function calendarProblemText(err: unknown): string {
  switch (classifyBookingFailure('book', err)) {
    case 'calendar_permissions':
      return 'their Google Calendar is connected without permission to add appointments (ask them to reconnect it with every box ticked).';
    case 'calendar_disconnected':
      return 'their Google Calendar is disconnected (ask them to reconnect it).';
    case 'calendar_error':
      return 'Google Calendar refused the event (usually temporary).';
    default:
      return 'the calendar step failed on our side.';
  }
}

/** Short technical tail for whoever debugs it later (no JSON dumps). */
function technicalNote(stage: BookingFailureStage, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof AppError ? err.code : 'error';
  const status = /failed: (\d{3})/.exec(message)?.[1];
  const firstLine = (message.split('\n')[0] ?? message).replace(/\s*\{\s*$/, '').slice(0, 120);
  return `${stage} step · ${code}${status ? ` ${status}` : ''} · ${firstLine}`;
}

const WHAT_WENT_WRONG: Record<BookingFailureKind, (business: string) => string> = {
  calendar_permissions: (b) =>
    `${b}'s Google Calendar is connected *without permission to add appointments*, so the booking couldn't be saved to their calendar. (Checking free times still works, which is why the bot could offer slots.)`,
  calendar_disconnected: (b) =>
    `${b}'s Google Calendar is *disconnected* (access was removed or expired), so the booking couldn't be saved.`,
  calendar_error: (b) =>
    `Google Calendar refused or failed to save the appointment on ${b}'s calendar. This is usually temporary on Google's side.`,
  payment_link: () =>
    `The booking-deposit payment link couldn't be created (Stripe), so the caller was never sent a link to pay.`,
  internal: () => `Something went wrong on our side while saving the appointment.`,
};

const FIX_FOR_OPERATOR: Record<BookingFailureKind, string | null> = {
  calendar_permissions:
    'Ask the operator to reconnect Google Calendar (Settings → Integrations, or the onboarding page) and *leave every box ticked* on Google\'s screen, then press "Run test booking". Until they do, every booking will fail like this.',
  calendar_disconnected:
    'Ask the operator to reconnect Google Calendar (Settings → Integrations, or the onboarding page). Until they do, every booking will fail like this.',
  calendar_error: null,
  payment_link: null,
  internal: 'Flag this to engineering with the technical note below.',
};

/** What the leftover appointment record means, so nobody misreads the caller's history. */
const RECORD_NOTE: Record<BookingFailureStage, string> = {
  book: 'The caller history may show this time as *cancelled*: that is this failed attempt, not the caller cancelling.',
  reserve: 'No appointment was saved.',
  fee_checkout:
    'The time is being held as *pending payment* and will be released automatically if nobody confirms it.',
  reschedule: "The caller's existing appointment was NOT moved; it is still at its original time.",
};

/** The operator's own wording ("your calendar") for the handoff email. */
const OPERATOR_WHAT_WENT_WRONG: Record<BookingFailureKind, string> = {
  calendar_permissions:
    "Your Google Calendar is connected without permission to add appointments, so we couldn't save the booking to your calendar.",
  calendar_disconnected:
    "Your Google Calendar is disconnected (access was removed or expired), so we couldn't save the booking.",
  calendar_error: 'Google Calendar failed to save the appointment. This is usually temporary on Google’s side.',
  payment_link: "We couldn't create the booking-deposit payment link, so the caller wasn't sent a link to pay.",
  internal: 'Something went wrong on our side while saving the appointment. Our team has been alerted.',
};

const OPERATOR_FIX: Record<BookingFailureKind, string | null> = {
  calendar_permissions:
    'Reconnect Google Calendar (Settings → Integrations) and leave every box ticked on Google’s screen, then press "Run test booking". Until you do, the assistant can’t book any caller.',
  calendar_disconnected:
    'Reconnect Google Calendar (Settings → Integrations). Until you do, the assistant can’t book any caller.',
  calendar_error: null,
  payment_link: null,
  internal: null,
};

/** Slack bold markers out, for email. */
const plain = (s: string): string => s.replaceAll('*', '');

function wantedLine(stage: BookingFailureStage, requestedTime: string): string {
  return stage === 'reschedule'
    ? `The caller asked to move their appointment to *${requestedTime}*, but it couldn't be moved.`
    : `The caller picked *${requestedTime}*, but the appointment could not be booked.`;
}

/**
 * Email copy for the operator and the admins (HandoffNotifierService adds the
 * caller's number, the "reply to the caller" step and the links).
 */
export function bookingFailureEmailContent(args: {
  stage: BookingFailureStage;
  err: unknown;
  businessName: string;
  requestedTime: string;
}): HandoffEmailContent {
  const kind = classifyBookingFailure(args.stage, args.err);
  const wanted = plain(wantedLine(args.stage, args.requestedTime));
  const record = plain(RECORD_NOTE[args.stage]);
  const verb = args.stage === 'reschedule' ? 'move it to' : 'add';
  return {
    operator: {
      why: `${wanted} ${OPERATOR_WHAT_WENT_WRONG[kind]} ${record}`,
      steps: [
        `If you confirm the time with the caller, ${verb} ${args.requestedTime} on your calendar yourself.`,
        ...(OPERATOR_FIX[kind] ? [OPERATOR_FIX[kind]] : []),
      ],
    },
    admin: {
      why: `${wanted} ${plain(WHAT_WENT_WRONG[kind](args.businessName))} ${record}`,
      steps: [
        `Put the appointment on ${args.businessName}'s calendar by hand, or ask them to.`,
        ...(FIX_FOR_OPERATOR[kind] ? [plain(FIX_FOR_OPERATOR[kind])] : []),
      ],
      technical: technicalNote(args.stage, args.err),
    },
  };
}

/**
 * Plain-English #hitl brief for a booking that failed: what the caller wanted,
 * why it failed, what to do, plus a one-line technical note. Read by ops staff
 * who aren't engineers (prod 2026-11-09 showed "events.insert failed: 403 {").
 */
export function bookingFailureBrief(args: {
  stage: BookingFailureStage;
  err: unknown;
  businessName: string;
  requestedTime: string;
}): string {
  const kind = classifyBookingFailure(args.stage, args.err);
  const wanted = wantedLine(args.stage, args.requestedTime);
  const steps = [
    `Reply in this thread to text the caller and confirm their time (they were told someone will reach out).`,
    `Put the appointment on ${args.businessName}'s calendar by hand, or ask them to.`,
    FIX_FOR_OPERATOR[kind],
  ].filter((s): s is string => s != null);

  return [
    wanted,
    `*What went wrong:* ${WHAT_WENT_WRONG[kind](args.businessName)}`,
    RECORD_NOTE[args.stage],
    `*What to do:*\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `_Technical: ${technicalNote(args.stage, args.err)}_`,
  ].join('\n');
}
