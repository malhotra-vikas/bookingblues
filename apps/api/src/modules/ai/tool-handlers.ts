import type { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import type { BookingsService } from '../appointments/bookings.service';
import type { IntakeAnswersService } from '../appointments/intake-answers.service';
import type { CalendarService } from '../calendar/calendar.service';
import { collectsIntakeAnswers, isOfficeAppointmentCategory } from './category-profile';
import { isBookingFeeCollectible } from './prompts';
import {
  addressConfirmedSms,
  addressNoteAddedSms,
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
  CollectServiceAddressArgs,
  EscalateToHumanArgs,
  MarkOutOfScopeArgs,
  MarkSpamArgs,
  ProposeSlotsArgs,
  RequestPaymentLinkArgs,
  RescheduleAppointmentArgs,
  SaveIntakeAnswersArgs,
} from './tool-definitions';
import { describeServiceArea, isZipInServiceArea, parseRadiusZones } from './service-area';
import { fullyBookedIntervals, travelBufferMinFor } from '../appointments/capacity';
import {
  describeLocalWallTime,
  localWallTimeToUtcIso,
  utcToLocalWallTime,
  weekdayOfLocalDate,
} from '../calendar/zoned-time';

/** Every local date in [start, end] with its weekday — `[{ date, weekday }]`, max 31. */
export function daysInWindow(startLocal: string, endLocal: string): Array<{ date: string; weekday: string }> {
  const out: Array<{ date: string; weekday: string }> = [];
  const [y, m, d] = startLocal.slice(0, 10).split('-').map(Number);
  const end = endLocal.slice(0, 10);
  for (let i = 0; i < 31; i += 1) {
    const ymd = new Date(Date.UTC(y!, m! - 1, d! + i)).toISOString().slice(0, 10);
    if (ymd > end) break;
    out.push({ date: ymd, weekday: weekdayOfLocalDate(ymd) });
  }
  return out;
}

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
  readonly intakeAnswers: IntakeAnswersService;
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

  // Capacity-aware availability (multi-truck, 2026-07-10). "Busy" = times where
  // ALL of the operator's trucks are already committed (each existing KeeprSteady
  // appointment padded by the travel buffer). With N trucks, up to N jobs run at
  // once, so a time is only unavailable when the Nth truck is taken. External
  // Google events are intentionally not counted here (product decision).
  const truckCount = ctx.operator.truck_count ?? 1;
  const tz = ctx.operator.timezone;
  const windowStartMs = new Date(localWallTimeToUtcIso(args.window_start, tz)).getTime();
  const windowEndMs = new Date(localWallTimeToUtcIso(args.window_end, tz)).getTime();
  const bufferMin = travelBufferMinFor(isOfficeAppointmentCategory(ctx.operator.category));
  const bufferMs = bufferMin * 60_000;

  const { data: rows, error } = await ctx.supabase
    .db()
    .from('appointments')
    .select('scheduled_for_start, scheduled_for_end')
    .eq('operator_id', ctx.operator.id)
    .in('status', ['proposed', 'confirmed'])
    .lt('scheduled_for_start', new Date(windowEndMs).toISOString())
    .gt('scheduled_for_end', new Date(windowStartMs - bufferMs - 12 * 3_600_000).toISOString());
  if (error) throw error;

  const existing = (rows ?? []).map((r) => ({
    start: new Date(r.scheduled_for_start).getTime(),
    end: new Date(r.scheduled_for_end).getTime(),
  }));
  const busy = fullyBookedIntervals({
    existing,
    truckCount,
    windowStart: windowStartMs,
    windowEnd: windowEndMs,
    bufferMin,
  }).map((iv) => ({
    start: utcToLocalWallTime(new Date(iv.start).toISOString(), tz),
    end: utcToLocalWallTime(new Date(iv.end).toISOString(), tz),
  }));

  // Everything the model sees is local wall-clock time (no offsets) — it
  // round-trips through book_appointment without the model doing DST math.
  return {
    content: {
      timezone: tz,
      times_are: 'local wall-clock time in the operator timezone',
      business_hours: ctx.operator.business_hours,
      truck_count: truckCount,
      busy,
      window: { start: args.window_start, end: args.window_end },
      // Weekday of every date in the window, so offers name the right day.
      days_in_window: daysInWindow(args.window_start, args.window_end),
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

/**
 * Insurance intake (category-profile.ts): validate + store the caller's answers,
 * encrypted, on the conversation. Booking copies them onto the appointment.
 * The tool response never echoes the answers back.
 */
export async function saveIntakeAnswers(
  args: SaveIntakeAnswersArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  if (!collectsIntakeAnswers(ctx.operator.category)) {
    return { content: { error: 'not_available', message: 'This business does not collect intake answers.' } };
  }
  await ctx.intakeAnswers.saveForConversation(ctx.conversation.id, args);
  return { content: { saved: true } };
}

async function intakeAnswersSaved(ctx: ToolContext): Promise<boolean> {
  // Read fresh: save_intake_answers may have run earlier in this same advance turn.
  const { data, error } = await ctx.supabase
    .db()
    .from('conversations')
    .select('intake_answers_enc')
    .eq('id', ctx.conversation.id)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.intake_answers_enc);
}

/** The caller's upcoming confirmed appointments with this operator (any conversation). */
async function upcomingAppointments(
  ctx: ToolContext,
): Promise<Array<{ id: string; scheduled_for_start: string; conversation_id: string | null }>> {
  const { data, error } = await ctx.supabase
    .db()
    .from('appointments')
    .select('id, scheduled_for_start, conversation_id')
    .eq('operator_id', ctx.operator.id)
    .eq('caller_phone_e164', ctx.callerPhoneE164)
    .eq('status', 'confirmed')
    .gt('scheduled_for_start', new Date().toISOString())
    .order('scheduled_for_start', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Move the caller's existing appointment (same row, same calendar event, same
 * deposit/payment). Never creates a second appointment. All categories.
 */
export async function rescheduleAppointment(
  args: RescheduleAppointmentArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    await ctx.bookings.reschedule({
      operator: ctx.operator,
      appointmentId: args.appointment_id,
      callerPhoneE164: ctx.callerPhoneE164,
      conversationId: ctx.conversation.id,
      startIso: localWallTimeToUtcIso(args.start, ctx.operator.timezone),
      endIso: localWallTimeToUtcIso(args.end, ctx.operator.timezone),
    });
    return {
      content: { appointment_id: args.appointment_id, status: 'rescheduled', moved_to: describeLocalWallTime(args.start) },
      // reschedule() already texted the caller the new time.
      state: 'completed',
      outcome: 'booked',
    };
  } catch (err) {
    if (err instanceof ConflictError) {
      return { content: { error: 'slot_unavailable', message: err.message } };
    }
    if (err instanceof ValidationError) {
      return { content: { error: 'invalid_request', message: err.message } };
    }
    return escalateFailedBooking('reschedule', args.start, err, ctx);
  }
}

/**
 * Office-appointment booking (Insurance Agencies): no deposit, no address step,
 * no emergency handling. Confirms and completes the conversation in one go.
 */
async function bookOfficeAppointment(args: BookAppointmentArgs, ctx: ToolContext): Promise<ToolResult> {
  if (collectsIntakeAnswers(ctx.operator.category) && !(await intakeAnswersSaved(ctx))) {
    return {
      content: {
        error: 'intake_missing',
        message: 'Collect the intake answers and call save_intake_answers before booking.',
      },
    };
  }
  try {
    const result = await ctx.bookings.book({
      operator: ctx.operator,
      conversationId: ctx.conversation.id,
      callerPhoneE164: ctx.callerPhoneE164,
      callerName: args.caller_name,
      ...(args.caller_email ? { callerEmail: args.caller_email } : {}),
      jobSummary: args.job_summary,
      startIso: localWallTimeToUtcIso(args.start, ctx.operator.timezone),
      endIso: localWallTimeToUtcIso(args.end, ctx.operator.timezone),
    });
    return {
      content: { appointment_id: result.appointmentId, status: 'confirmed', booked_for: describeLocalWallTime(args.start) },
      // book() already texted the confirmation — finish without another SMS.
      state: 'completed',
      outcome: 'booked',
    };
  } catch (err) {
    if (err instanceof ConflictError || err instanceof ValidationError) {
      return { content: { error: 'slot_unavailable', message: err.message } };
    }
    return escalateFailedBooking('book', args.start, err, ctx);
  }
}

export async function bookAppointment(
  args: BookAppointmentArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  // A caller changing the time of an appointment they already have must be MOVED,
  // not booked twice ("reschedule to Saturday" left Sunday AND added Saturday,
  // prod 2026-11-04). Office categories: any upcoming appointment blocks a new
  // one. Trades: a separate second job is legitimate, so only the appointment
  // booked earlier in THIS conversation blocks (the duplicate case).
  const office = isOfficeAppointmentCategory(ctx.operator.category);
  const upcoming = (await upcomingAppointments(ctx)).filter(
    (a) => office || a.conversation_id === ctx.conversation.id,
  );
  if (upcoming.length > 0) {
    return {
      content: {
        error: 'already_booked',
        message:
          `This caller already has an upcoming appointment (id ${upcoming[0]!.id}). To change its day or time, ` +
          'call reschedule_appointment with that id — never book a second one. If they clearly want an ' +
          'ADDITIONAL, separate appointment, call escalate_to_human so the team can arrange it.',
      },
    };
  }
  if (office) return bookOfficeAppointment(args, ctx);

  const common = {
    operator: ctx.operator,
    conversationId: ctx.conversation.id,
    callerPhoneE164: ctx.callerPhoneE164,
    callerName: args.caller_name,
    ...(args.caller_email ? { callerEmail: args.caller_email } : {}),
    jobSummary: args.job_summary,
    urgency: args.urgency,
    startIso: localWallTimeToUtcIso(args.start, ctx.operator.timezone),
    endIso: localWallTimeToUtcIso(args.end, ctx.operator.timezone),
  };

  const feeCollectible = isBookingFeeCollectible(ctx.operator);
  const isEmergency = args.urgency === 'emergency' || args.immediate_danger === true;
  const unpaidDanger =
    args.immediate_danger === true && ctx.operator.allow_unpaid_emergency_booking === true;
  // Operator's gross take for an emergency = deposit + emergency visit fee.
  const operatorTakeCents =
    (ctx.operator.booking_fee_cents ?? 0) +
    (isEmergency ? ctx.operator.emergency_visit_fee_cents ?? 0 : 0);

  // Immediate-danger AND the operator opted in to unpaid emergency bookings:
  // book NOW without payment (tech rushes out), flag for on-site collection.
  if (feeCollectible && unpaidDanger) {
    try {
      await ctx.bookings.book({
        ...common,
        collectPaymentOnSite: true,
        feeCents: operatorTakeCents,
      });
    } catch (err) {
      if (err instanceof ConflictError || err instanceof ValidationError) {
        return { content: { error: 'slot_unavailable', message: err.message } };
      }
      return escalateFailedBooking('book', args.start, err, ctx);
    }
    return {
      content: {
        status: 'confirmed_payment_on_site',
        amount_owed_cents: operatorTakeCents,
        note: 'Emergency booked without prepayment; flagged for on-site collection.',
      },
      // book() already sent the confirmation (which asks for the address) — keep
      // the conversation open so `collect_service_address` can finalize.
      stopLoop: true,
    };
  }

  // When a booking fee is collectible, collect it BEFORE confirming (§9.5):
  // reserve the slot (held, no calendar event yet) and text a payment link.
  // Emergencies add the operator's emergency visit fee to the charge.
  if (feeCollectible) {
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
      return escalateFailedBooking('reserve', args.start, err, ctx);
    }

    let session: Awaited<ReturnType<typeof ctx.payments.createBookingFeeCheckout>>;
    try {
      session = await ctx.payments.createBookingFeeCheckout({
        operatorId: ctx.operator.id,
        appointmentId,
        ...(isEmergency ? { emergency: true } : {}),
      });
    } catch (err) {
      // The slot stays held (the hold sweeper expires it if nobody acts); the
      // human taking over can confirm it or let it lapse.
      return escalateFailedBooking('fee_checkout', args.start, err, ctx);
    }

    const friendlyTime = new Date(common.startIso).toLocaleString('en-US', {
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
        booked_for: describeLocalWallTime(args.start),
        payment_required: true,
        fee_cents: operatorTakeCents,
        // What the caller actually pays (deposit + service fee on top) — quote
        // this, not fee_cents, if the caller asks.
        total_charged_cents: session.charge.totalCents,
        emergency: isEmergency,
        payment_url: session.url,
        status: 'held_pending_payment',
      },
      // Single self-contained SMS with the link; keep the conversation open
      // (non-terminal) so the caller can pay, then the webhook confirms.
      outboundMessage: reservationHoldSms({
        businessName: ctx.operator.business_name,
        friendlyTime,
        charge: session.charge,
        checkoutUrl: session.url,
        callerName: args.caller_name,
      }),
      stopLoop: true,
    };
  }

  // No fee collectible — book immediately (shared pipeline: advisory lock,
  // calendar insert, confirmation SMS with the tap-to-add ICS link). The
  // confirmation already asks for the property address, so keep the
  // conversation OPEN (stopLoop) — `collect_service_address` finalizes it.
  try {
    const result = await ctx.bookings.book(common);
    return {
      content: {
        appointment_id: result.appointmentId,
        booked_for: describeLocalWallTime(args.start),
        ics_url: result.icsUrl,
        booking_fee_required: false,
        status: 'confirmed_awaiting_address',
      },
      stopLoop: true,
    };
  } catch (err) {
    if (err instanceof ConflictError || err instanceof ValidationError) {
      return { content: { error: 'slot_unavailable', message: err.message } };
    }
    return escalateFailedBooking('book', args.start, err, ctx);
  }
}

export async function collectServiceAddress(
  args: CollectServiceAddressArgs,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Find the confirmed appointment for this conversation (the just-booked one).
  const { data: appt, error } = await ctx.supabase
    .db()
    .from('appointments')
    .select('id, service_address, scheduled_for_start')
    .eq('conversation_id', ctx.conversation.id)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!appt) {
    return {
      content: { error: 'no_confirmed_appointment', message: 'No confirmed appointment to attach an address to yet.' },
    };
  }

  // First time → save the address. If we already have one, the caller is adding
  // access notes (gate code, keys, parking) — append them rather than overwrite
  // or repeat the "got your address" confirmation (QA 2026-06-30).
  const alreadyHadAddress = Boolean(appt.service_address && appt.service_address.trim());
  const combined = alreadyHadAddress ? `${appt.service_address}; ${args.address}` : args.address;
  await ctx.bookings.setServiceAddress(appt.id, combined);

  if (alreadyHadAddress) {
    return {
      content: { ok: true, appointment_id: appt.id, appended: true },
      state: 'completed',
      outcome: 'booked',
      outboundMessage: addressNoteAddedSms(),
    };
  }

  const friendlyTime = new Date(appt.scheduled_for_start).toLocaleString('en-US', {
    timeZone: ctx.operator.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return {
    content: { ok: true, appointment_id: appt.id },
    state: 'completed',
    outcome: 'booked',
    outboundMessage: addressConfirmedSms(friendlyTime),
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
  insurance: 'Medicare, health, life, and other personal insurance coverage',
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
  return openHumanHandoff(normaliseReason(args.reason), args.reason, ctx);
}

async function openHumanHandoff(
  reasonNorm: ReturnType<typeof normaliseReason>,
  reasonText: string,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    const { deliveredVia } = await ctx.escalations.openEscalation({
      operator: ctx.operator,
      conversation: ctx.conversation,
      callerPhoneE164: ctx.callerPhoneE164,
      reason: reasonNorm,
      reasonText,
      openedBy: reasonNorm === 'caller_requested' ? 'caller' : 'bot',
    });
    ctx.logger.info(
      { conversationId: ctx.conversation.id, reason: reasonText, deliveredVia },
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
    content: { acknowledged: true, reason: reasonText },
    state: 'escalated',
    outboundMessage: escalationHandoffSms(),
  };
}

/**
 * A booking step failed with an error the model can't fix by picking another
 * time (calendar permission/outage, Stripe, DB). Hand the caller to a human
 * with what they asked for, instead of letting the error escape to the generic
 * "someone will text you back" fallback, which only alerts the #convos thread
 * (insurance has none, so nobody was told; prod 2026-11-09). Taken or
 * unavailable slots are NOT routed here: the model re-offers times for those.
 */
async function escalateFailedBooking(
  stage: 'book' | 'reserve' | 'fee_checkout' | 'reschedule',
  requestedLocal: string,
  err: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split('\n')[0] ?? message;
  ctx.logger.error(
    {
      operatorId: ctx.operator.id,
      conversationId: ctx.conversation.id,
      stage,
      err: message.slice(0, 500),
    },
    'booking failed — escalating to a human',
  );
  const reason =
    `Booking failed (${stage}) for ${describeLocalWallTime(requestedLocal)}: ${firstLine}`.slice(0, 240) +
    ' — book it manually and confirm with the caller.';
  // Explicit enum: the error text is free-form and could trip normaliseReason
  // (e.g. "Request …" + "caller" would read as caller_requested).
  return openHumanHandoff('bot_stuck', reason, ctx);
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
