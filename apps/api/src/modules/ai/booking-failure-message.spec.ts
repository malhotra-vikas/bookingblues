import { ExternalServiceError, NotFoundError } from '../../common/errors/app-error';
import { bookingFailureBrief, classifyBookingFailure } from './booking-failure-message';

const GOOGLE_403 = new ExternalServiceError(
  'google',
  'events.insert failed: 403 {\n  "error": {\n    "code": 403,\n    "message": "Request had insufficient authentication scopes.",\n    "status": "PERMISSION_DENIED"\n  }\n}',
);

describe('classifyBookingFailure', () => {
  it('missing calendar permission (prod 2026-11-09)', () => {
    expect(classifyBookingFailure('book', GOOGLE_403)).toBe('calendar_permissions');
  });

  it('revoked / disconnected calendar', () => {
    expect(
      classifyBookingFailure('book', new ExternalServiceError('google', 'Calendar grant revoked (401 on events.insert)')),
    ).toBe('calendar_disconnected');
    expect(
      classifyBookingFailure('book', new NotFoundError('Calendar connection is revoked — operator must reconnect')),
    ).toBe('calendar_disconnected');
    expect(classifyBookingFailure('book', new NotFoundError('Calendar connection not found'))).toBe(
      'calendar_disconnected',
    );
  });

  it('other Google failures', () => {
    expect(
      classifyBookingFailure('book', new ExternalServiceError('google', 'events.insert failed: 503 backend error')),
    ).toBe('calendar_error');
  });

  it('payment link and everything else', () => {
    expect(classifyBookingFailure('fee_checkout', new Error('stripe down'))).toBe('payment_link');
    expect(classifyBookingFailure('book', new Error('db timeout'))).toBe('internal');
  });
});

describe('bookingFailureBrief', () => {
  const brief = bookingFailureBrief({
    stage: 'book',
    err: GOOGLE_403,
    businessName: 'Jamal Insurance',
    requestedTime: 'Thu, Nov 19, 9:00 AM',
  });

  it('says what the caller wanted, why it failed and what to do, in plain words', () => {
    expect(brief).toContain('The caller picked *Thu, Nov 19, 9:00 AM*, but the appointment could not be booked.');
    expect(brief).toContain(
      "Jamal Insurance's Google Calendar is connected *without permission to add appointments*",
    );
    expect(brief).toContain('*What to do:*\n1. Reply in this thread to text the caller');
    expect(brief).toContain('3. Ask the operator to reconnect Google Calendar');
  });

  it("explains the 'cancelled' entry in the caller's history", () => {
    expect(brief).toContain('that is this failed attempt, not the caller cancelling');
  });

  it('keeps the technical detail to one tidy line (no JSON)', () => {
    expect(brief).toContain('_Technical: book step · external.google 403 · events.insert failed: 403_');
    expect(brief).not.toContain('"error"');
    expect(brief).not.toContain('{');
  });

  it('reschedule says the existing appointment was not moved', () => {
    const r = bookingFailureBrief({
      stage: 'reschedule',
      err: GOOGLE_403,
      businessName: 'Acme',
      requestedTime: 'Fri, Nov 20, 10:00 AM',
    });
    expect(r).toContain('asked to move their appointment to *Fri, Nov 20, 10:00 AM*');
    expect(r).toContain('was NOT moved');
  });

  it('an internal error gets no reconnect step, but an engineering flag', () => {
    const r = bookingFailureBrief({
      stage: 'book',
      err: new Error('db timeout'),
      businessName: 'Acme',
      requestedTime: 'Fri, Nov 20, 10:00 AM',
    });
    expect(r).not.toContain('reconnect');
    expect(r).toContain('Flag this to engineering');
  });
});
