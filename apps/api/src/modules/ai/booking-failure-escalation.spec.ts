import type { PinoLogger } from 'nestjs-pino';

import { ConflictError, ExternalServiceError } from '../../common/errors/app-error';
import { bookAppointment, rescheduleAppointment } from './tool-handlers';
import type { ToolContext } from './tool-handlers';
import type { BookAppointmentArgs } from './tool-definitions';

// Prod 2026-11-09: an insurance booking failed at Google events.insert (403,
// calendar.events scope not granted). The error escaped the tool, the caller got
// the generic "someone will text you back" fallback, and nobody was alerted.
// A booking that fails for a reason the model can't fix must escalate to #hitl.

function makeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as PinoLogger;
}

/** Chainable Supabase stub: list queries resolve to `list`, maybeSingle to `single`. */
function makeSupabase(single: unknown = { data: null, error: null }): ToolContext['supabase'] {
  const list = { data: [], error: null };
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'gt', 'order', 'in', 'limit']) q[m] = () => q;
  q.maybeSingle = () => Promise.resolve(single);
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(list).then(res, rej);
  return { db: () => q } as unknown as ToolContext['supabase'];
}

function makeCtx(over: {
  operator?: Record<string, unknown>;
  bookings?: Record<string, unknown>;
  payments?: Record<string, unknown>;
  supabase?: ToolContext['supabase'];
}): { ctx: ToolContext; open: jest.Mock } {
  const open = jest.fn().mockResolvedValue({ escalation: { id: 'esc_1' }, deliveredVia: 'slack' });
  const ctx: ToolContext = {
    operator: {
      id: 'op_1',
      business_name: 'Acme',
      category: 'plumbing',
      timezone: 'America/New_York',
      twilio_number_e164: '+15555550001',
      booking_fee_enabled: false,
      ...over.operator,
    } as unknown as ToolContext['operator'],
    conversation: { id: 'conv_1' } as unknown as ToolContext['conversation'],
    callerPhoneE164: '+15555550002',
    supabase: over.supabase ?? makeSupabase(),
    calendar: {} as never,
    twilio: {} as never,
    conversations: {} as never,
    payments: (over.payments ?? {}) as unknown as ToolContext['payments'],
    escalations: { openEscalation: open } as unknown as ToolContext['escalations'],
    bookings: (over.bookings ?? {}) as unknown as ToolContext['bookings'],
    intakeAnswers: {} as never,
    logger: makeLogger(),
  };
  return { ctx, open };
}

const ARGS: BookAppointmentArgs = {
  start: '2026-11-13T11:00',
  end: '2026-11-13T12:00',
  caller_name: 'Pat',
  job_summary: 'Medicare plan review',
  urgency: 'normal',
};

const GOOGLE_403 = new ExternalServiceError(
  'google',
  'events.insert failed: 403 {\n "error": { "message": "Request had insufficient authentication scopes." } }',
);

describe('booking failures escalate to a human', () => {
  it('insurance: a calendar failure escalates (bot_stuck) instead of throwing', async () => {
    const { ctx, open } = makeCtx({
      operator: { category: 'insurance' },
      supabase: makeSupabase({ data: { intake_answers_enc: 'enc' }, error: null }),
      bookings: { book: jest.fn().mockRejectedValue(GOOGLE_403) },
    });
    const result = await bookAppointment(ARGS, ctx);
    expect(result.state).toBe('escalated');
    expect(result.outboundMessage).toMatch(/passed your message to the team/);
    const call = open.mock.calls[0]?.[0];
    // Error text contains "Request" and the reason mentions the caller — must
    // NOT be misread as a caller-requested hand-off.
    expect(call.reason).toBe('bot_stuck');
    expect(call.openedBy).toBe('bot');
    expect(call.reasonText).toContain('The caller picked *Fri, Nov 13, 11:00 AM*');
    expect(call.reasonText).toContain('without permission to add appointments');
    expect(call.reasonText).toContain('Technical: book step · external.google 403');
  });

  it('trades (no fee): an unexpected failure escalates', async () => {
    const { ctx, open } = makeCtx({
      bookings: { book: jest.fn().mockRejectedValue(new Error('db timeout')) },
    });
    const result = await bookAppointment(ARGS, ctx);
    expect(result.state).toBe('escalated');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('trades (fee): a Stripe checkout failure escalates', async () => {
    const { ctx, open } = makeCtx({
      operator: {
        booking_fee_enabled: true,
        booking_fee_cents: 5000,
        subscription_status: 'active',
        stripe_connect_charges_enabled: true,
        stripe_connect_payouts_enabled: true,
      },
      bookings: { reserve: jest.fn().mockResolvedValue({ appointmentId: 'appt_1' }) },
      payments: { createBookingFeeCheckout: jest.fn().mockRejectedValue(new Error('stripe down')) },
    });
    const result = await bookAppointment(ARGS, ctx);
    expect(result.state).toBe('escalated');
    expect(open.mock.calls[0]?.[0].reasonText).toContain('payment link couldn');
  });

  it('a taken slot is NOT escalated — the model re-offers times', async () => {
    const { ctx, open } = makeCtx({
      bookings: { book: jest.fn().mockRejectedValue(new ConflictError('That slot was just taken')) },
    });
    const result = await bookAppointment(ARGS, ctx);
    expect(result.state).toBeUndefined();
    expect(result.content).toMatchObject({ error: 'slot_unavailable' });
    expect(open).not.toHaveBeenCalled();
  });

  it('reschedule: a calendar failure escalates', async () => {
    const { ctx, open } = makeCtx({
      bookings: { reschedule: jest.fn().mockRejectedValue(GOOGLE_403) },
    });
    const result = await rescheduleAppointment(
      {
        appointment_id: '68d5eea3-5b42-4ec7-a841-005731750c76',
        start: '2026-11-13T11:00',
        end: '2026-11-13T12:00',
      },
      ctx,
    );
    expect(result.state).toBe('escalated');
    expect(open.mock.calls[0]?.[0].reasonText).toContain('asked to move their appointment');
  });
});
