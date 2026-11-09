import { AppError, NotFoundError } from '../../common/errors/app-error';

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
  const wanted =
    args.stage === 'reschedule'
      ? `The caller asked to move their appointment to *${args.requestedTime}*, but it couldn't be moved.`
      : `The caller picked *${args.requestedTime}*, but the appointment could not be booked.`;
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
