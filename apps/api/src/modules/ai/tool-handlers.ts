import type { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import { ConflictError, ValidationError } from '../../common/errors/app-error';
import type { CalendarService } from '../calendar/calendar.service';
import type { ConversationsService } from '../conversations/conversations.service';
import type { PaymentsService } from '../payments/payments.service';
import type { SupabaseService } from '../../common/supabase/supabase.service';
import type { TwilioService } from '../../common/twilio/twilio.service';
import type {
  BookAppointmentArgs,
  CheckAvailabilityArgs,
  EscalateToHumanArgs,
  MarkOutOfScopeArgs,
  MarkSpamArgs,
  ProposeSlotsArgs,
  RequestPaymentLinkArgs,
} from './tool-definitions';

type OperatorRow = Tables<'operators'>;
type ConversationRow = Tables<'conversations'>;

export interface ToolContext {
  readonly operator: OperatorRow;
  readonly conversation: ConversationRow;
  readonly callerPhoneE164: string;
  readonly supabase: SupabaseService;
  readonly calendar: CalendarService;
  readonly twilio: TwilioService;
  readonly conversations: ConversationsService;
  readonly payments: PaymentsService;
  readonly logger: PinoLogger;
}

export type TerminalState = 'completed' | 'escalated';
export type Outcome =
  | 'booked'
  | 'out_of_scope'
  | 'spam'
  | 'rejected'
  | 'no_show_intent'
  | 'timeout';

export interface ToolResult {
  /** JSON body returned to OpenAI as the tool's response. */
  readonly content: unknown;
  /** Terminal status to set on the conversation (if any). */
  readonly state?: TerminalState;
  readonly outcome?: Outcome;
  /** Out-of-band SMS to send to the caller after this tool. */
  readonly outboundMessage?: string;
  /** Stop the model loop and stop sending model output (used for spam). */
  readonly silentTerminate?: boolean;
}

export async function checkAvailability(
  args: CheckAvailabilityArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  const conn = await ctx.calendar.getConnection(ctx.operator.id);
  if (!conn || conn.status === 'revoked') {
    return {
      content: {
        error: 'calendar_not_connected',
        message: 'Operator has not connected a calendar; cannot check availability.',
      },
    };
  }
  const busy = await ctx.calendar.freeBusy({
    operatorId: ctx.operator.id,
    windowStart: args.window_start,
    windowEnd: args.window_end,
    timeZone: ctx.operator.timezone,
  });
  // Slice 7 returns busy intervals + the operator's business_hours so the
  // model can compute candidate slots itself. Slice 9 (web) will likely
  // surface a UI-friendly slot picker on top of this.
  return {
    content: {
      timezone: ctx.operator.timezone,
      business_hours: ctx.operator.business_hours,
      busy,
      window: { start: args.window_start, end: args.window_end },
    },
  };
}

export function proposeSlots(args: ProposeSlotsArgs): ToolResult {
  // Pure formatter — the model uses this to format an SMS-friendly proposal.
  // We just echo the structured slots back; the model writes the final SMS.
  return { content: { slots: args.slots } };
}

export async function bookAppointment(
  args: BookAppointmentArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (new Date(args.end).getTime() <= new Date(args.start).getTime()) {
    throw new ValidationError('book_appointment.end must be after start');
  }

  // Insert first; the partial unique index on (operator_id, scheduled_for_start)
  // for status IN ('proposed','confirmed') is the race-protection (CLAUDE.md §17).
  const { data: appt, error: insertErr } = await ctx.supabase
    .db()
    .from('appointments')
    .insert({
      operator_id: ctx.operator.id,
      conversation_id: ctx.conversation.id,
      caller_phone_e164: ctx.callerPhoneE164,
      caller_name: args.caller_name,
      ...(args.caller_email ? { caller_email: args.caller_email } : {}),
      job_summary: args.job_summary,
      scheduled_for_start: args.start,
      scheduled_for_end: args.end,
      status: 'confirmed',
    })
    .select('id')
    .single();
  if (insertErr) {
    if (insertErr.code === '23505') {
      throw new ConflictError('That slot was just taken — pick another.');
    }
    throw insertErr;
  }
  const appointmentId = appt.id;

  // Try to insert the calendar event. If it fails, revert the appointment so
  // we don't have a phantom booking the operator never sees.
  try {
    const calendarRes = await ctx.calendar.insertEvent({
      operatorId: ctx.operator.id,
      summary: `${ctx.operator.business_name}: ${args.job_summary.slice(0, 80)}`,
      description: `Caller: ${args.caller_name} ${ctx.callerPhoneE164}\nUrgency: ${args.urgency}\n\n${args.job_summary}`,
      startIso: args.start,
      endIso: args.end,
      timeZone: ctx.operator.timezone,
      attendeeEmails: args.caller_email ? [args.caller_email] : [],
    });
    await ctx.supabase
      .db()
      .from('appointments')
      .update({ google_event_id: calendarRes.id })
      .eq('id', appointmentId);
  } catch (err) {
    await ctx.supabase
      .db()
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appointmentId);
    ctx.logger.error(
      { appointmentId, err: (err as Error).message },
      'Calendar insert failed; appointment cancelled',
    );
    throw err;
  }

  return {
    content: {
      appointment_id: appointmentId,
      booking_fee_required:
        ctx.operator.booking_fee_enabled && ctx.operator.booking_fee_cents != null,
    },
    state: 'completed',
    outcome: 'booked',
  };
}

export async function requestPaymentLink(
  args: RequestPaymentLinkArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const session = await ctx.payments.createBookingFeeCheckout({
      operatorId: ctx.operator.id,
      appointmentId: args.appointment_id,
    });
    return {
      content: { url: session.url, payment_id: session.paymentId },
      // SMS the caller the link directly — the model SHOULD also acknowledge
      // it conversationally, but we send it here so we never lose it to a
      // hallucinated paraphrase.
      outboundMessage: `Reserve your slot with the booking fee here: ${session.url}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn({ appointmentId: args.appointment_id, err: message }, 'request_payment_link failed');
    return {
      content: { error: 'fee_unavailable', message },
    };
  }
}

export function markOutOfScope(args: MarkOutOfScopeArgs): ToolResult {
  return {
    content: { acknowledged: true, reason: args.reason },
    state: 'completed',
    outcome: 'out_of_scope',
    outboundMessage:
      "Sorry — that request is outside what we handle. Wishing you the best finding the right help.",
  };
}

export function markSpam(args: MarkSpamArgs): ToolResult {
  return {
    content: { acknowledged: true, reason: args.reason },
    state: 'completed',
    outcome: 'spam',
    silentTerminate: true,
  };
}

export function escalateToHuman(args: EscalateToHumanArgs, ctx: ToolContext): ToolResult {
  // Slice 10 (Resend) wires the email; Slice 7.5 wires the Slack thread. For
  // now we transition the conversation to `escalated` and the operator can
  // see the transcript in their dashboard (Slice 9).
  ctx.logger.info(
    { conversationId: ctx.conversation.id, reason: args.reason },
    'escalate_to_human — Slice 7.5 (Slack) and Slice 10 (email) will deliver this',
  );
  return {
    content: { acknowledged: true, reason: args.reason },
    state: 'escalated',
    outboundMessage:
      "I've passed your message to the team — someone will reach out shortly.",
  };
}
