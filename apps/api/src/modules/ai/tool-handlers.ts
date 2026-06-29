import type { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import type { BookingsService } from '../appointments/bookings.service';
import type { CalendarService } from '../calendar/calendar.service';
import { isBookingFeeCollectible } from './prompts';
import {
  escalationHandoffSms,
  outOfScopeAreaSms,
  outOfScopeGenericSms,
  outOfScopeServiceSms,
  paymentLinkSms,
  reservationHoldSms,
} from '../conversations/templates/sms-templates';
import { ConflictError, ValidationError } from '../../common/errors/app-error';
import type { ConversationsService } from '../conversations/conversations.service';
import type { PaymentsService } from '../payments/payments.service';
import type { EscalationsService } from '../slack/escalations.service';
import type { SupabaseService } from '../../common/supabase/supabase.service';
import type { TwilioService } from '../../common/twilio/twilio.service';
import type {
  BookAppointmentArgs,
  CheckAvailabilityArgs,
  CheckServiceAreaArgs,
  EscalateToHumanArgs,
  MarkOutOfScopeArgs,
  MarkSpamArgs,
  ProposeSlotsArgs,
  RequestPaymentLinkArgs,
} from './tool-definitions';
import { describeServiceArea, isZipInServiceArea, parseRadiusZones } from './service-area';

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
  readonly escalations: EscalationsService;
  readonly bookings: BookingsService;
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
  /**
   * Stop the model loop and send `outboundMessage` as the sole reply, WITHOUT
   * marking the conversation terminal. Used by the Reserve→Pay→Confirm fee
   * path: we hold the slot, send one self-contained payment-link SMS, and keep
   * the conversation open (awaiting payment) so a single message carries the
   * link (avoids the §9.3 rate-limit splitting it from a separate ack).
   */
  readonly stopLoop?: boolean;
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

export function checkServiceArea(args: CheckServiceAreaArgs, ctx: ToolContext): ToolResult {
  const { configured, inArea } = isZipInServiceArea(ctx.operator, args.zip);
  return {
    content: {
      zip: args.zip,
      in_area: inArea,
      configured,
      service_area: describeServiceArea(ctx.operator),
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
  const common = {
    operator: ctx.operator,
    conversationId: ctx.conversation.id,
    callerPhoneE164: ctx.callerPhoneE164,
    callerName: args.caller_name,
    ...(args.caller_email ? { callerEmail: args.caller_email } : {}),
    jobSummary: args.job_summary,
    urgency: args.urgency,
    startIso: args.start,
    endIso: args.end,
  };

  // When a booking fee is collectible, collect it BEFORE confirming (§9.5):
  // reserve the slot (held, no calendar event yet) and text a payment link.
  // The Connect `payment_intent.succeeded` webhook confirms the booking.
  if (isBookingFeeCollectible(ctx.operator)) {
    let appointmentId: string;
    try {
      const reserved = await ctx.bookings.reserve(common);
      appointmentId = reserved.appointmentId;
    } catch (err) {
      // A taken slot / closed-day / out-of-hours is a normal condition — feed
      // it back to the model to re-propose, NEVER throw (a throw misfires the
      // "AI failed" fallback + alert, QA 2026-06-29).
      if (err instanceof ConflictError || err instanceof ValidationError) {
        return { content: { error: 'slot_unavailable', message: err.message } };
      }
      throw err;
    }

    let session: { url: string; paymentId: string };
    try {
      session = await ctx.payments.createBookingFeeCheckout({
        operatorId: ctx.operator.id,
        appointmentId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.warn({ appointmentId, err: message }, 'reserve: createBookingFeeCheckout failed');
      return { content: { error: 'fee_unavailable', message } };
    }

    const friendlyTime = new Date(args.start).toLocaleString('en-US', {
      timeZone: ctx.operator.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return {
      content: {
        appointment_id: appointmentId,
        payment_required: true,
        fee_cents: ctx.operator.booking_fee_cents,
        payment_url: session.url,
        status: 'held_pending_payment',
      },
      // Single self-contained SMS with the link; keep the conversation open
      // (non-terminal) so the caller can pay, then the webhook confirms.
      outboundMessage: reservationHoldSms({
        businessName: ctx.operator.business_name,
        friendlyTime,
        feeCents: ctx.operator.booking_fee_cents!,
        checkoutUrl: session.url,
      }),
      stopLoop: true,
    };
  }

  // No fee collectible — book immediately (shared pipeline: advisory lock,
  // calendar insert, confirmation SMS with the tap-to-add ICS link).
  try {
    const result = await ctx.bookings.book(common);
    return {
      content: {
        appointment_id: result.appointmentId,
        ics_url: result.icsUrl,
        booking_fee_required: false,
      },
      state: 'completed',
      outcome: 'booked',
    };
  } catch (err) {
    if (err instanceof ConflictError || err instanceof ValidationError) {
      return { content: { error: 'slot_unavailable', message: err.message } };
    }
    throw err;
  }
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
      outboundMessage: paymentLinkSms(session.url),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.warn({ appointmentId: args.appointment_id, err: message }, 'request_payment_link failed');
    return {
      content: { error: 'fee_unavailable', message },
    };
  }
}

/**
 * Plain-English example services per trade — mentioned in the out-of-scope
 * handoff so the caller knows what the business *does* do (not just what it
 * doesn't). Keep each list short and concrete; full SMS must stay under
 * one segment (~300 chars after the operator name + framing).
 */
const SERVICES_BY_CATEGORY: Record<string, string> = {
  plumbing: 'leaks, water heaters, drain clogs, fixtures, and pipe repairs',
  hvac: 'AC repair, heating, system installs, and maintenance',
  electrical: 'wiring, panels, outlets, lighting, and troubleshooting',
  roofing: 'leaks, repairs, full replacements, gutters, and inspections',
  garage_door: 'broken springs, openers, door repairs, and new installs',
};

export function markOutOfScope(args: MarkOutOfScopeArgs, ctx: ToolContext): ToolResult {
  const services = ctx.operator.category
    ? SERVICES_BY_CATEGORY[ctx.operator.category]
    : undefined;
  const reasonLower = args.reason.toLowerCase();
  const isAreaReason =
    reasonLower.includes('service_area') ||
    reasonLower.includes('service area') ||
    (reasonLower.includes('outside') && reasonLower.includes('area'));
  const areaConfigured =
    (ctx.operator.service_zip_codes ?? []).length > 0 ||
    parseRadiusZones(ctx.operator.service_radius_zones).length > 0;

  let closing: string;
  if (areaConfigured && isAreaReason) {
    // Out-of-area handoff — describe the real coverage (radius zones + ZIPs),
    // not just the explicit ZIP list.
    closing = outOfScopeAreaSms(ctx.operator.business_name, describeServiceArea(ctx.operator));
  } else if (services) {
    closing = outOfScopeServiceSms(ctx.operator.business_name, services);
  } else {
    closing = outOfScopeGenericSms(ctx.operator.business_name);
  }

  return {
    content: { acknowledged: true, reason: args.reason },
    state: 'completed',
    outcome: 'out_of_scope',
    outboundMessage: closing,
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

export async function escalateToHuman(
  args: EscalateToHumanArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Slice 7.5: bot-initiated escalation opens a Slack thread (or falls back
  // to email when Slack isn't configured). Either way the conversation flips
  // to `escalated` so the AI advance loop won't reply on new caller messages —
  // those are bridged to the human's Slack thread instead.
  const reasonNorm = normaliseReason(args.reason);
  try {
    const { deliveredVia } = await ctx.escalations.openEscalation({
      operator: ctx.operator,
      conversation: ctx.conversation,
      callerPhoneE164: ctx.callerPhoneE164,
      reason: reasonNorm,
      reasonText: args.reason,
      openedBy: reasonNorm === 'caller_requested' ? 'caller' : 'bot',
    });
    ctx.logger.info(
      { conversationId: ctx.conversation.id, reason: args.reason, deliveredVia },
      'escalate_to_human opened escalation',
    );
  } catch (err) {
    // EscalationsService already flips the conversation status before posting,
    // so even if Slack fails we're in a consistent state. Surface to logs.
    ctx.logger.error(
      { err: (err as Error).message, conversationId: ctx.conversation.id },
      'escalate_to_human failed to open Slack escalation; conversation still flipped',
    );
  }
  return {
    content: { acknowledged: true, reason: args.reason },
    state: 'escalated',
    outboundMessage: escalationHandoffSms(),
  };
}

/** Map free-form reason text from the model to the closed enum the DB expects. */
function normaliseReason(
  reason: string,
):
  | 'bot_stuck'
  | 'caller_requested'
  | 'operator_forced'
  | 'calendar_revoked'
  | 'turn_cap' {
  const r = reason.toLowerCase();
  if (r.includes('caller') && r.includes('request')) return 'caller_requested';
  if (r.includes('human')) return 'caller_requested';
  if (r.includes('turn cap') || r.includes('turn_cap')) return 'turn_cap';
  if (r.includes('calendar') && r.includes('revok')) return 'calendar_revoked';
  return 'bot_stuck';
}
