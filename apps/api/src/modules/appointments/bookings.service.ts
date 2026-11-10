import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { EmailService } from '../../common/email/email.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { compactUuid } from '../../common/util/uuid';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CalendarService } from '../calendar/calendar.service';
import { asBusinessHours, slotWithinBusinessHours } from '../calendar/business-hours';
import { isOfficeAppointmentCategory } from '../ai/category-profile';
import { describeLocalWallTime, utcToLocalWallTime } from '../calendar/zoned-time';
import { hasCapacity, travelBufferMinFor } from './capacity';
import { earliestBookableMs, minLeadMinutesFor } from './lead-time';
import {
  changedDetailLabels,
  type IntakeAnswers,
  intakeAnswersText,
  mergeIntakeAnswers,
  type UpdateAppointmentDetailsArgs,
} from './intake-answers';
import { brandedEmailHtml, escapeHtml } from '../../common/email/email-layout';
import { fetchOperatorEmail } from '../../common/email/staff-recipients';
import { IntakeAnswersService } from './intake-answers.service';
import { ConversationsService } from '../conversations/conversations.service';
import {
  bookingConfirmationSms,
  bookingFeeLine,
  callWindowFor,
  type FeeCharge,
  holdExpiredSms,
  rescheduleConfirmationSms,
} from '../conversations/templates/sms-templates';
import { isBookingFeeCollectible } from '../ai/prompts';
import { PaymentsService } from '../payments/payments.service';
import { operatorNetCents } from '../payments/pricing';
import { renderBookingSummary } from '../summaries/email-templates';

type OperatorRow = Tables<'operators'>;
type Urgency = 'low' | 'normal' | 'high' | 'emergency';

export interface BookResult {
  readonly appointmentId: string;
  readonly icsUrl: string;
  /** Google Calendar event URL — operator's deep link to the new event. */
  readonly operatorEventUrl: string | null;
}

/**
 * Single booking pipeline used by the AI tool, the `/bb book` slash command,
 * and the "📅 Book a slot" button on the escalation alarm. All paths share:
 *
 *   - Capacity check (≤ truck_count concurrent, with travel buffer) before insert
 *   - Google Calendar event insert (rolls back the appointment if it fails)
 *   - Confirmation SMS to the caller with a public ICS deep-link
 *   - Audit log (only for non-AI paths; the AI tool already audits at the
 *     advance layer)
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly calendar: CalendarService,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly audit: AuditLogService,
    private readonly payments: PaymentsService,
    private readonly email: EmailService,
    private readonly intakeAnswers: IntakeAnswersService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(BookingsService.name);
  }

  async book(args: {
    operator: OperatorRow;
    conversationId: string | null;
    callerPhoneE164: string;
    callerName: string;
    callerEmail?: string;
    jobSummary: string;
    urgency?: Urgency;
    startIso: string;
    endIso: string;
    /** `null` for AI-driven bookings; `user_id` for /bb book or button click. */
    bookedByUserId?: string | null;
    /**
     * When true (manual book paths), if §9.5 eligibility passes, generate
     * the booking-fee Checkout link and append it to the confirmation SMS.
     * The AI tool path keeps this off — the bot orchestrates the fee step
     * itself via `request_payment_link` so it can phrase the message.
     */
    chargeFeeIfEligible?: boolean;
    /**
     * Booked WITHOUT taking payment (immediate-danger emergency path). Flags the
     * appointment for on-site collection and records the amount owed in fee_cents.
     */
    collectPaymentOnSite?: boolean;
    /** Amount owed, recorded on the appointment (used with collectPaymentOnSite). */
    feeCents?: number;
    /**
     * Manual (Slack) bookings: keep the appointment when the Google Calendar
     * insert fails, instead of cancelling it. A person has already agreed the
     * time with the caller, so the booking must be recorded (reminder,
     * dashboard, confirmation); the result says the calendar step failed so
     * Slack can ask for it to be added by hand. The AI path keeps the rollback.
     */
    calendarOptional?: boolean;
    /** Manual (Slack) bookings: skip the minimum notice (lead-time.ts); a person agreed the time. */
    skipLeadTime?: boolean;
  }): Promise<BookResult & { feeCheckoutUrl: string | null; calendarError: unknown }> {
    await this.assertSlotBookable(args.operator, args.startIso, args.endIso, undefined, {
      skipLeadTime: args.skipLeadTime === true,
    });

    // 1. Insert appointment row. Capacity (≤ truck_count concurrent, with travel
    //    buffer) is enforced in assertSlotBookable above; the old exact-start
    //    unique index was dropped for multi-truck (migration 20260710000001).
    const { data: appt, error: insertErr } = await this.supabase
      .db()
      .from('appointments')
      .insert({
        operator_id: args.operator.id,
        conversation_id: args.conversationId,
        caller_phone_e164: args.callerPhoneE164,
        caller_name: args.callerName,
        ...(args.callerEmail ? { caller_email: args.callerEmail } : {}),
        job_summary: args.jobSummary,
        scheduled_for_start: args.startIso,
        scheduled_for_end: args.endIso,
        status: 'confirmed',
        ...(args.collectPaymentOnSite ? { collect_payment_on_site: true } : {}),
        ...(args.feeCents != null ? { fee_cents: args.feeCents } : {}),
      })
      .select('id')
      .single();
    if (insertErr) {
      if (insertErr.code === '23505') {
        throw new ConflictError('That slot was just taken — pick another time.');
      }
      throw insertErr;
    }
    const appointmentId = appt.id;
    const office = isOfficeAppointmentCategory(args.operator.category);

    // 1b. Intake answers (insurance): copy the encrypted answers from the
    //     conversation onto the appointment, and show them to the operator on
    //     their calendar event. Never in the summary/title or the public ICS.
    let intake: IntakeAnswers | null = null;
    if (office) {
      intake = await this.intakeAnswers.attachToAppointment(appointmentId, args.conversationId);
    }

    // 2. Google Calendar event — roll back the appointment if Google rejects
    //    so we never leave a phantom booking the operator can't see. (Manual
    //    bookings with calendarOptional keep it: a person agreed the time.)
    let operatorEventUrl: string | null = null;
    let calendarError: unknown = null;
    try {
      const calendarRes = await this.calendar.insertEvent({
        operatorId: args.operator.id,
        summary: `${args.operator.business_name}: ${args.jobSummary.slice(0, 80)}`,
        description: this.eventDescription({
          ...args,
          ...(office ? { office: true } : {}),
          ...(intake ? { intakeText: intakeAnswersText(intake) } : {}),
          ...(args.collectPaymentOnSite && args.feeCents != null
            ? { payoutLine: `⚠ COLLECT ${this.dollars(args.feeCents)} ON SITE — emergency booking, not prepaid.` }
            : {}),
        }),
        startIso: args.startIso,
        endIso: args.endIso,
        timeZone: args.operator.timezone,
        attendeeEmails: args.callerEmail ? [args.callerEmail] : [],
      });
      operatorEventUrl = calendarRes.htmlLink;
      await this.supabase
        .db()
        .from('appointments')
        .update({ google_event_id: calendarRes.id })
        .eq('id', appointmentId);
    } catch (err) {
      if (args.calendarOptional) {
        calendarError = err;
        this.logger.warn(
          { appointmentId, err: (err as Error).message },
          'Calendar insert failed; manual booking kept (not on Google Calendar)',
        );
      } else {
        await this.supabase
          .db()
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('id', appointmentId);
        this.logger.error(
          { appointmentId, err: (err as Error).message },
          'Calendar insert failed; appointment cancelled',
        );
        throw err;
      }
    }

    const icsUrl = this.icsUrl(appointmentId);

    // 3a. If the manual path requested it AND §9.5 eligibility passes, also
    //     generate the booking-fee Checkout URL so the confirmation SMS can
    //     ask the caller to pay. Eligibility failure (e.g. Connect not done)
    //     silently falls through to a no-fee confirmation — that's the §9.5
    //     contract. Stripe failures are logged and skipped; the appointment
    //     itself is durable so we still send the booking confirmation.
    let feeCheckoutUrl: string | null = null;
    let feeCharge: FeeCharge | null = null;
    if (args.chargeFeeIfEligible && isBookingFeeCollectible(args.operator)) {
      try {
        const session = await this.payments.createBookingFeeCheckout({
          operatorId: args.operator.id,
          appointmentId,
        });
        feeCheckoutUrl = session.url;
        feeCharge = session.charge;
      } catch (err) {
        this.logger.warn(
          { appointmentId, err: (err as Error).message },
          'manual book: createBookingFeeCheckout failed (sending confirmation without fee)',
        );
      }
    }

    // 3b. Confirmation SMS to caller — calendar link + (optionally) fee CTA.
    //     The operator gets their own event in Google Calendar via insertEvent
    //     above. Failure to send the SMS is non-fatal — the appointment is
    //     booked DB + calendar-side; we log and continue.
    if (args.conversationId) {
      await this.sendConfirmationSms({
        operator: args.operator,
        conversationId: args.conversationId,
        callerPhoneE164: args.callerPhoneE164,
        startIso: args.startIso,
        endIso: args.endIso,
        icsUrl,
        feeCheckoutUrl,
        feeCharge,
        callerName: args.callerName,
        // Ask for the address only on the AI conversational path (which can
        // handle the reply); manual/Slack-button books pass chargeFeeIfEligible
        // and aren't an interactive SMS thread. Office appointments never ask.
        askAddress: !args.chargeFeeIfEligible && !office,
      }).catch((err) => {
        this.logger.warn(
          { appointmentId, err: (err as Error).message },
          'confirmation SMS failed (non-fatal — booking is durable)',
        );
      });
    }

    // 4. Audit log for non-AI paths. The AI dispatcher already writes an
    //    audit at advance time; double-logging there would be noisy.
    if (args.bookedByUserId !== undefined) {
      await this.audit.write({
        actorUserId: args.bookedByUserId,
        operatorId: args.operator.id,
        action: 'appointment.manual_book',
        resourceType: 'appointment',
        resourceId: appointmentId,
        metadata: {
          conversation_id: args.conversationId,
          start: args.startIso,
          end: args.endIso,
          caller_name: args.callerName,
          on_google_calendar: calendarError == null,
        },
      });
    }

    // 5. Operator email — fire-and-forget summary with full transcript +
    //    appointment details. Failure here MUST NOT fail the booking: the
    //    SMS and calendar event already landed, so the operator can recover
    //    from the dashboard if email is down.
    void this.sendOperatorBookingEmail({
      operator: args.operator,
      appointmentId,
      conversationId: args.conversationId,
      callerName: args.callerName,
      callerPhoneE164: args.callerPhoneE164,
      callerEmail: args.callerEmail ?? null,
      jobSummary: args.jobSummary,
      startIso: args.startIso,
      endIso: args.endIso,
      operatorEventUrl,
      intake,
    }).catch((err) => {
      this.logger.warn(
        { appointmentId, err: (err as Error).message },
        'booking summary email failed (non-fatal)',
      );
    });

    return { appointmentId, icsUrl, operatorEventUrl, feeCheckoutUrl, calendarError };
  }

  /**
   * A returning caller corrects a detail on their upcoming appointment (insurance
   * intake answers and/or email). Same appointment; the answers are merged and
   * re-encrypted, the operator's calendar event description is refreshed
   * (best-effort), and the operator is emailed WHICH details changed, never the
   * values (health information stays out of email).
   */
  async updateDetails(args: {
    operator: OperatorRow;
    appointmentId: string;
    callerPhoneE164: string;
    changes: UpdateAppointmentDetailsArgs;
  }): Promise<{ answers: IntakeAnswers | null; changed: string[] }> {
    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, operator_id, caller_phone_e164, caller_name, job_summary, status, scheduled_for_start, scheduled_for_end, google_event_id')
      .eq('id', args.appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (
      !appt ||
      appt.operator_id !== args.operator.id ||
      appt.caller_phone_e164 !== args.callerPhoneE164 ||
      appt.status !== 'confirmed' ||
      new Date(appt.scheduled_for_start).getTime() <= Date.now()
    ) {
      throw new ValidationError('No upcoming confirmed appointment with that id for this caller.');
    }

    const changed = changedDetailLabels(args.changes);
    const { appointment_id: _id, caller_email: callerEmail, ...intakeChanges } = args.changes;
    let answers: IntakeAnswers | null = await this.intakeAnswers.forAppointment(appt.id);
    const touchesIntake = Object.values(intakeChanges).some((v) => v !== undefined);
    if (touchesIntake) {
      const next: IntakeAnswers = {
        ...Object.fromEntries(Object.entries(intakeChanges).filter(([, v]) => v !== undefined)),
        first_name: intakeChanges.first_name ?? answers?.first_name ?? appt.caller_name ?? 'Caller',
        prescriptions: intakeChanges.prescriptions ?? [],
      };
      answers = mergeIntakeAnswers(answers, next);
      await this.intakeAnswers.saveForAppointment(appt.id, answers);
    }
    if (callerEmail) {
      const { error: emailErr } = await this.supabase
        .db()
        .from('appointments')
        .update({ caller_email: callerEmail })
        .eq('id', appt.id);
      if (emailErr) throw emailErr;
    }

    // Keep the operator's own calendar event in step (it carries the intake block).
    if (touchesIntake && appt.google_event_id) {
      await this.calendar
        .patchEvent({
          operatorId: args.operator.id,
          eventId: appt.google_event_id,
          description: this.eventDescription({
            callerName: appt.caller_name ?? 'Caller',
            callerPhoneE164: appt.caller_phone_e164,
            jobSummary: appt.job_summary ?? '',
            office: true,
            ...(answers ? { intakeText: intakeAnswersText(answers) } : {}),
          }),
        })
        .catch((err) =>
          this.logger.warn(
            { appointmentId: appt.id, err: (err as Error).message },
            'details update: calendar description not refreshed (non-fatal)',
          ),
        );
    }

    await this.audit.write({
      actorUserId: null,
      operatorId: args.operator.id,
      action: 'appointment.details_updated',
      resourceType: 'appointment',
      resourceId: appt.id,
      metadata: { fields: changed, by: 'ai' },
    });

    void this.emailOperatorDetailsUpdated({
      operator: args.operator,
      callerName: appt.caller_name,
      startIso: appt.scheduled_for_start,
      changed,
    }).catch((err) =>
      this.logger.warn({ appointmentId: appt.id, err: (err as Error).message }, 'details-updated email failed (non-fatal)'),
    );

    return { answers, changed };
  }

  /** "Vikas updated: Date of birth, Doctor" with a dashboard link. Labels only, no values. */
  private async emailOperatorDetailsUpdated(args: {
    operator: OperatorRow;
    callerName: string | null;
    startIso: string;
    changed: string[];
  }): Promise<void> {
    if (!this.email.isConfigured() || args.changed.length === 0) return;
    const to = await fetchOperatorEmail(this.supabase.db(), args.operator.user_id);
    if (!to) return;
    const who = args.callerName?.trim() || 'A caller';
    const when = this.friendlyTime(args.startIso, args.operator.timezone);
    const list = args.changed.join(', ');
    const dashboard = `${this.env.APP_URL.replace(/\/$/, '')}/dashboard`;
    const res = await this.email.send({
      to,
      subject: `Appointment details updated: ${who}, ${when}`,
      html: brandedEmailHtml({
        heading: 'Appointment details updated',
        bodyHtml:
          `<p style="margin:0 0 14px;">${escapeHtml(who)} updated their details by text for the appointment on ${escapeHtml(when)}.</p>` +
          `<p style="margin:0;"><strong>Changed:</strong> ${escapeHtml(list)}</p>`,
        cta: { label: 'See the appointment', href: dashboard },
        footnoteHtml: 'For privacy, the new details are shown on your dashboard, not in this email.',
      }),
      text:
        `${who} updated their details by text for the appointment on ${when}.\n` +
        `Changed: ${list}\n\nSee the appointment: ${dashboard}\n` +
        'For privacy, the new details are shown on your dashboard, not in this email.',
    });
    if (!res.delivered) {
      this.logger.warn({ operatorId: args.operator.id, reason: res.reason }, 'details-updated email NOT sent');
    }
  }

  /**
   * Move a caller's upcoming confirmed appointment to a new slot — the SAME
   * appointment row and calendar event, never a second booking (live test
   * 2026-11-04: "reschedule to Saturday" created a duplicate and left Sunday
   * standing). Same capacity/business-hours checks as booking (the moved
   * appointment doesn't block itself). The calendar event is moved FIRST, so a
   * Google failure leaves the DB unchanged. Texts the caller the new time and
   * re-arms the 24h reminder.
   */
  async reschedule(args: {
    operator: OperatorRow;
    appointmentId: string;
    callerPhoneE164: string;
    conversationId: string | null;
    startIso: string;
    endIso: string;
  }): Promise<{ appointmentId: string; previousStartIso: string }> {
    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, operator_id, caller_phone_e164, caller_name, status, scheduled_for_start, google_event_id')
      .eq('id', args.appointmentId)
      .maybeSingle();
    if (error) throw error;
    // Only the caller's own, still-upcoming, confirmed appointment with THIS operator.
    if (
      !appt ||
      appt.operator_id !== args.operator.id ||
      appt.caller_phone_e164 !== args.callerPhoneE164 ||
      appt.status !== 'confirmed' ||
      new Date(appt.scheduled_for_start).getTime() <= Date.now()
    ) {
      throw new ValidationError('No upcoming confirmed appointment with that id for this caller.');
    }
    // A "move" to the time it already has would text a confusing "has been moved".
    if (new Date(appt.scheduled_for_start).getTime() === new Date(args.startIso).getTime()) {
      throw new ValidationError(
        'That is already the appointment\'s current time — ask which new day/time they want and offer other open slots.',
      );
    }

    await this.assertSlotBookable(args.operator, args.startIso, args.endIso, appt.id);

    if (appt.google_event_id) {
      await this.calendar.patchEvent({
        operatorId: args.operator.id,
        eventId: appt.google_event_id,
        startIso: args.startIso,
        endIso: args.endIso,
        timeZone: args.operator.timezone,
      });
    }

    const { error: updErr } = await this.supabase
      .db()
      .from('appointments')
      .update({
        scheduled_for_start: args.startIso,
        scheduled_for_end: args.endIso,
        // The new time needs its own 24h reminder.
        reminder_sent_at: null,
      })
      .eq('id', appt.id);
    if (updErr) throw updErr;

    await this.audit.write({
      actorUserId: null,
      operatorId: args.operator.id,
      action: 'appointment.rescheduled',
      resourceType: 'appointment',
      resourceId: appt.id,
      metadata: { from: appt.scheduled_for_start, to: args.startIso, by: 'ai' },
    });

    if (args.conversationId && args.operator.twilio_number_e164) {
      const body = rescheduleConfirmationSms({
        businessName: args.operator.business_name,
        friendlyTime: this.friendlyTime(args.startIso, args.operator.timezone),
        icsUrl: this.icsUrl(appt.id),
        callerName: appt.caller_name,
        category: args.operator.category,
        ...(isOfficeAppointmentCategory(args.operator.category)
          ? { callWindow: callWindowFor(args.startIso, args.endIso, args.operator.timezone) }
          : {}),
      });
      try {
        const send = await this.twilio.sendSms({
          from: args.operator.twilio_number_e164,
          to: args.callerPhoneE164,
          body,
        });
        await this.conversations.appendMessage({
          conversationId: args.conversationId,
          role: 'system',
          body: 'sid' in send ? body : `[skipped: ${send.skipped}] ${body}`,
          ...('sid' in send ? { twilioMessageSid: send.sid } : {}),
        });
      } catch (err) {
        this.logger.warn(
          { appointmentId: appt.id, err: (err as Error).message },
          'reschedule SMS failed (non-fatal — appointment is moved)',
        );
      }
    }

    return { appointmentId: appt.id, previousStartIso: appt.scheduled_for_start };
  }

  private friendlyTime(iso: string, timeZone: string): string {
    return new Date(iso).toLocaleString('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  /**
   * Validate a candidate slot against the operator's business hours (in their
   * timezone) and basic sanity. Throws `ValidationError` — the AI tool layer
   * catches it and feeds the reason back to the model to re-propose, so a
   * closed-day/out-of-hours slot never reaches a real calendar event (the
   * model proposed weekend slots despite Mon–Fri hours, QA 2026-06-29).
   */
  private async assertSlotBookable(
    operator: OperatorRow,
    startIso: string,
    endIso: string,
    /** Reschedule: the appointment being moved doesn't block its own new slot. */
    excludeAppointmentId?: string,
    /** Manual (Slack) bookings: a person agreed the time, so no minimum notice. */
    opts: { skipLeadTime?: boolean } = {},
  ): Promise<void> {
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (endMs <= startMs) {
      throw new ValidationError('Appointment end must be after start');
    }
    if (!opts.skipLeadTime) {
      const earliest = earliestBookableMs(operator);
      if (startMs < earliest) {
        const local = utcToLocalWallTime(new Date(earliest).toISOString(), operator.timezone);
        throw new ValidationError(
          `That time is too soon: appointments need at least ${minLeadMinutesFor(operator) / 60} hours' notice. ` +
            `The earliest bookable time is ${describeLocalWallTime(local)}. Offer later times.`,
        );
      }
    }
    const check = slotWithinBusinessHours(
      startIso,
      endIso,
      asBusinessHours(operator.business_hours),
      operator.timezone,
    );
    if (!check.ok) {
      throw new ValidationError(`That time isn't available: ${check.reason}`);
    }

    // Multi-truck capacity: allow up to `truck_count` concurrent appointments,
    // with a travel buffer between same-truck jobs (none for office
    // appointments). Load the operator's active appointments that could
    // overlap the candidate's padded window and check.
    const truckCount = operator.truck_count ?? 1;
    const bufferMin = travelBufferMinFor(isOfficeAppointmentCategory(operator.category));
    const bufferMs = bufferMin * 60_000;
    const overlapFrom = new Date(startMs - bufferMs - 12 * 3_600_000).toISOString();
    const overlapTo = new Date(endMs + bufferMs).toISOString();
    const { data: rows, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, scheduled_for_start, scheduled_for_end')
      .eq('operator_id', operator.id)
      .in('status', ['proposed', 'confirmed'])
      .lt('scheduled_for_start', overlapTo)
      .gt('scheduled_for_end', overlapFrom);
    if (error) throw error;
    const existing = (rows ?? []).filter((r) => r.id !== excludeAppointmentId).map((r) => ({
      start: new Date(r.scheduled_for_start).getTime(),
      end: new Date(r.scheduled_for_end).getTime(),
    }));
    const ok = hasCapacity({
      candidate: { start: startMs, end: endMs },
      existing,
      truckCount,
      bufferMin,
    });
    if (!ok) {
      throw new ConflictError('That slot was just taken — pick another time.');
    }
  }

  /**
   * Reserve a slot pending payment (Reserve→Pay→Confirm, CLAUDE.md §9.5 — fee
   * collected BEFORE the appointment is confirmed). Inserts a `proposed` row,
   * which holds the slot via the partial unique index, but creates NO Google
   * Calendar event and sends NO confirmation. `confirmPaidBooking` finalizes it
   * once the Connect `payment_intent.succeeded` webhook lands; an unpaid hold is
   * swept by `releaseExpiredHolds`.
   */
  async reserve(args: {
    operator: OperatorRow;
    conversationId: string | null;
    callerPhoneE164: string;
    callerName: string;
    callerEmail?: string;
    jobSummary: string;
    urgency?: Urgency;
    startIso: string;
    endIso: string;
  }): Promise<{ appointmentId: string }> {
    await this.assertSlotBookable(args.operator, args.startIso, args.endIso);

    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .insert({
        operator_id: args.operator.id,
        conversation_id: args.conversationId,
        caller_phone_e164: args.callerPhoneE164,
        caller_name: args.callerName,
        ...(args.callerEmail ? { caller_email: args.callerEmail } : {}),
        job_summary: args.jobSummary,
        scheduled_for_start: args.startIso,
        scheduled_for_end: args.endIso,
        status: 'proposed',
        fee_status: 'pending',
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        throw new ConflictError('That slot was just taken — pick another time.');
      }
      throw error;
    }
    return { appointmentId: appt.id };
  }

  /**
   * Finalize a reserved booking after its booking fee is paid. Called from the
   * Connect `payment_intent.succeeded` handler. Idempotent: a second delivery
   * (Stripe retries) is a no-op once the calendar event exists. Creates the
   * Google event, flips the appointment to `confirmed`, sends the caller
   * confirmation + operator email, and completes the conversation.
   */
  async confirmPaidBooking(appointmentId: string): Promise<void> {
    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .select(
        'id, operator_id, conversation_id, caller_phone_e164, caller_name, caller_email, job_summary, scheduled_for_start, scheduled_for_end, status, google_event_id',
      )
      .eq('id', appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (!appt) {
      this.logger.warn({ appointmentId }, 'confirmPaidBooking: appointment not found');
      return;
    }
    if (appt.google_event_id) {
      // Already finalized (idempotent re-delivery) — nothing to do.
      return;
    }

    const { data: operator, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('id', appt.operator_id)
      .single();
    if (opErr) throw opErr;

    // Operator payout line for the invite — what they net after our fee + Stripe.
    const { data: pay } = await this.supabase
      .db()
      .from('payments')
      .select('amount_cents, application_fee_cents')
      .eq('appointment_id', appt.id)
      .eq('type', 'booking_fee')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const payoutLine = pay
      ? `Your payout: ${this.dollars(operatorNetCents({ chargeCents: pay.amount_cents, applicationFeeCents: pay.application_fee_cents ?? 0 }))} ` +
        `(deposit ${this.dollars(pay.amount_cents - (pay.application_fee_cents ?? 0))} less card processing)`
      : undefined;

    let operatorEventUrl: string | null = null;
    try {
      const calendarRes = await this.calendar.insertEvent({
        operatorId: operator.id,
        summary: `${operator.business_name}: ${appt.job_summary.slice(0, 80)}`,
        description: this.eventDescription({
          callerName: appt.caller_name ?? '',
          callerPhoneE164: appt.caller_phone_e164,
          jobSummary: appt.job_summary,
          ...(payoutLine ? { payoutLine } : {}),
        }),
        startIso: appt.scheduled_for_start,
        endIso: appt.scheduled_for_end,
        timeZone: operator.timezone,
        attendeeEmails: appt.caller_email ? [appt.caller_email] : [],
      });
      operatorEventUrl = calendarRes.htmlLink;
      await this.supabase
        .db()
        .from('appointments')
        .update({ google_event_id: calendarRes.id, status: 'confirmed' })
        .eq('id', appt.id);
    } catch (err) {
      // Payment succeeded but calendar failed — DO NOT cancel (the caller paid).
      // Leave the row paid+proposed and alert via logs so a human can recover.
      this.logger.error(
        { appointmentId, err: (err as Error).message },
        'confirmPaidBooking: calendar insert failed after payment — needs manual follow-up',
      );
      throw err;
    }

    if (appt.conversation_id) {
      await this.sendConfirmationSms({
        operator,
        conversationId: appt.conversation_id,
        callerPhoneE164: appt.caller_phone_e164,
        startIso: appt.scheduled_for_start,
        icsUrl: this.icsUrl(appt.id),
        feeCheckoutUrl: null,
        feeCharge: null,
        callerName: appt.caller_name,
        askAddress: true,
      }).catch((smsErr) => {
        this.logger.warn(
          { appointmentId, err: (smsErr as Error).message },
          'confirmPaidBooking: confirmation SMS failed (non-fatal)',
        );
      });

      // Keep the conversation OPEN so the caller's address reply runs the AI
      // (which calls `collect_service_address` to patch the calendar). The
      // conversation completes there. Reset `started_at` so this post-confirm
      // exchange doesn't inherit the booking turns toward the §9.3 cap.
      await this.supabase
        .db()
        .from('conversations')
        .update({ status: 'awaiting_caller', started_at: new Date().toISOString() })
        .eq('id', appt.conversation_id);
    }

    void this.sendOperatorBookingEmail({
      operator,
      appointmentId: appt.id,
      conversationId: appt.conversation_id,
      callerName: appt.caller_name ?? '',
      callerPhoneE164: appt.caller_phone_e164,
      callerEmail: appt.caller_email ?? null,
      jobSummary: appt.job_summary,
      startIso: appt.scheduled_for_start,
      endIso: appt.scheduled_for_end,
      operatorEventUrl,
    }).catch((emailErr) => {
      this.logger.warn(
        { appointmentId, err: (emailErr as Error).message },
        'confirmPaidBooking: operator email failed (non-fatal)',
      );
    });
  }

  /**
   * Sweep reserved-but-unpaid holds older than the TTL, cancel them (freeing the
   * slot via the partial unique index), and text the caller that the hold
   * lapsed. Driven by an internal cron endpoint (same pattern as reminders).
   * Idempotent: only acts on rows still `proposed` + fee `pending`.
   */
  async releaseExpiredHolds(ttlMinutes = 30): Promise<{ released: number }> {
    const cutoffIso = new Date(Date.now() - ttlMinutes * 60_000).toISOString();
    const { data: stale, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, operator_id, conversation_id, caller_phone_e164, scheduled_for_start')
      .eq('status', 'proposed')
      .eq('fee_status', 'pending')
      .lt('created_at', cutoffIso)
      .limit(50);
    if (error) throw error;
    if (!stale || stale.length === 0) return { released: 0 };

    let released = 0;
    for (const appt of stale) {
      const { error: updErr } = await this.supabase
        .db()
        .from('appointments')
        .update({ status: 'cancelled', fee_status: 'expired' })
        .eq('id', appt.id)
        .eq('status', 'proposed'); // guard against a concurrent confirm
      if (updErr) {
        this.logger.warn(
          { appointmentId: appt.id, err: updErr.message },
          'releaseExpiredHolds: cancel failed',
        );
        continue;
      }
      released += 1;

      const { data: operator } = await this.supabase
        .db()
        .from('operators')
        .select('business_name, twilio_number_e164, timezone')
        .eq('id', appt.operator_id)
        .maybeSingle();
      if (operator?.twilio_number_e164) {
        const friendlyTime = new Date(appt.scheduled_for_start).toLocaleString('en-US', {
          timeZone: operator.timezone,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
        const body = holdExpiredSms(operator.business_name, friendlyTime);
        try {
          const send = await this.twilio.sendSms({
            from: operator.twilio_number_e164,
            to: appt.caller_phone_e164,
            body,
          });
          if (appt.conversation_id) {
            await this.conversations.appendMessage({
              conversationId: appt.conversation_id,
              role: 'system',
              body: 'sid' in send ? body : `[skipped: ${send.skipped}] ${body}`,
              ...('sid' in send ? { twilioMessageSid: send.sid } : {}),
            });
          }
        } catch (smsErr) {
          this.logger.warn(
            { appointmentId: appt.id, err: (smsErr as Error).message },
            'releaseExpiredHolds: hold-expired SMS failed',
          );
        }
      }
    }
    this.logger.info({ released }, 'releaseExpiredHolds swept expired holds');
    return { released };
  }

  /**
   * Save the caller's full property address on an appointment and patch it onto
   * the Google Calendar event's `location`. Used by the AI's
   * `collect_service_address` tool AND the operator's manual "Mark resolved"
   * (when they enter an address they gathered by phone). Calendar patch is
   * best-effort — the address is saved regardless.
   */
  async setServiceAddress(appointmentId: string, address: string): Promise<void> {
    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, operator_id, google_event_id, job_summary, caller_name, caller_phone_e164')
      .eq('id', appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (!appt) throw new NotFoundError('Appointment not found');

    await this.supabase
      .db()
      .from('appointments')
      .update({ service_address: address })
      .eq('id', appt.id);

    if (appt.google_event_id) {
      try {
        await this.calendar.patchEvent({
          operatorId: appt.operator_id,
          eventId: appt.google_event_id,
          location: address,
          description:
            `Caller: ${appt.caller_name ?? ''} ${appt.caller_phone_e164}\n` +
            `Address: ${address}\n\n${appt.job_summary}`,
        });
      } catch (err) {
        this.logger.warn(
          { appointmentId, err: (err as Error).message },
          'setServiceAddress: calendar patch failed (address still saved)',
        );
      }
    }
  }

  private async sendOperatorBookingEmail(args: {
    operator: OperatorRow;
    appointmentId: string;
    conversationId: string | null;
    callerName: string;
    callerPhoneE164: string;
    callerEmail: string | null;
    jobSummary: string;
    startIso: string;
    endIso: string;
    operatorEventUrl: string | null;
    /** Decrypted intake answers (insurance) to show the operator. */
    intake?: IntakeAnswers | null;
  }): Promise<void> {
    if (!this.email.isConfigured()) return;

    const { data: userResp } = await this.supabase
      .db()
      .auth.admin.getUserById(args.operator.user_id);
    const toEmail = userResp?.user?.email;
    if (!toEmail) return;

    // Re-read the appointment so we get the current fee status (set by the
    // payments path after the Stripe webhook lands, if applicable). For
    // bookings without a fee, fee_cents stays null.
    const { data: apptRow } = await this.supabase
      .db()
      .from('appointments')
      .select('id, caller_name, caller_phone_e164, caller_email, job_summary, scheduled_for_start, scheduled_for_end, fee_cents, fee_status')
      .eq('id', args.appointmentId)
      .single();
    if (!apptRow) return;

    // Pull the full transcript so the operator has caller context before
    // showing up. Capped at the most recent 100 messages — anything beyond
    // that is almost certainly not useful and would bloat the email.
    const transcript = args.conversationId
      ? (
          await this.supabase
            .db()
            .from('messages')
            .select('role, body, created_at')
            .eq('conversation_id', args.conversationId)
            .order('created_at', { ascending: true })
            .limit(100)
        ).data ?? []
      : [];

    const template = renderBookingSummary({
      operator: args.operator,
      appointment: apptRow,
      transcript,
      googleEventUrl: args.operatorEventUrl,
      platformAppUrl: this.env.APP_URL,
      intake: args.intake ?? null,
    });

    await this.email.send({
      to: toEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      ...(args.callerEmail ? { replyTo: args.callerEmail } : {}),
    });
  }

  /** Public, unauthenticated deep-link the caller can tap to add to their calendar.
   *  Short, hyphen-free `/cal/:token` form (302 → the .ics) so it stays tappable
   *  in SMS — hyphens in the UUID were breaking link detection. */
  icsUrl(appointmentId: string): string {
    return `${this.env.API_URL}/cal/${compactUuid(appointmentId)}`;
  }

  /**
   * Build a VCALENDAR/VEVENT body for the caller. Wide-compat plain text —
   * Apple Calendar, Google Calendar, Outlook all accept this format.
   */
  buildIcsBody(args: {
    appointmentId: string;
    operatorName: string;
    jobSummary: string;
    startIso: string;
    endIso: string;
    callerPhoneE164: string;
  }): string {
    const dt = (iso: string): string =>
      iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').replace(/Z$/, 'Z');
    const escape = (s: string): string =>
      s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//KeeprSteady//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${args.appointmentId}@bookingblues`,
      `DTSTAMP:${dt(new Date().toISOString())}`,
      `DTSTART:${dt(args.startIso)}`,
      `DTEND:${dt(args.endIso)}`,
      `SUMMARY:${escape(args.operatorName)} appointment`,
      `DESCRIPTION:${escape(args.jobSummary)}`,
      `LOCATION:${escape(args.callerPhoneE164)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    // RFC 5545 uses CRLF line endings.
    return lines.join('\r\n') + '\r\n';
  }

  private dollars(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  private eventDescription(args: {
    callerName: string;
    callerPhoneE164: string;
    urgency?: Urgency;
    jobSummary: string;
    /** Optional "you made $X on this booking" line (after fees), shown to the operator. */
    payoutLine?: string;
    /** Office appointment (insurance): no urgency line. */
    office?: boolean;
    /** Intake answers block (insurance), shown on the operator's own calendar. */
    intakeText?: string;
  }): string {
    const urgency = args.urgency ?? 'normal';
    return (
      `Caller: ${args.callerName} ${args.callerPhoneE164}\n` +
      (args.office ? '' : `Urgency: ${urgency}\n`) +
      (args.payoutLine ? `${args.payoutLine}\n` : '') +
      `\n${args.jobSummary}` +
      (args.intakeText ? `\n\n${args.intakeText}` : '')
    );
  }

  private async sendConfirmationSms(args: {
    operator: OperatorRow;
    conversationId: string;
    callerPhoneE164: string;
    startIso: string;
    /** End of the appointment: office (phone) appointments text the whole call window. */
    endIso?: string;
    icsUrl: string;
    feeCheckoutUrl: string | null;
    feeCharge?: FeeCharge | null;
    callerName?: string | null;
    /** Ask for the full property address in the confirmation (post-confirm). */
    askAddress?: boolean;
  }): Promise<void> {
    if (!args.operator.twilio_number_e164) return;
    const callWindow =
      isOfficeAppointmentCategory(args.operator.category) && args.endIso
        ? callWindowFor(args.startIso, args.endIso, args.operator.timezone)
        : undefined;
    const friendlyTime = new Date(args.startIso).toLocaleString('en-US', {
      timeZone: args.operator.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const feeLine =
      args.feeCheckoutUrl && args.feeCharge ? bookingFeeLine(args.feeCharge, args.feeCheckoutUrl) : '';
    const body = bookingConfirmationSms({
      businessName: args.operator.business_name,
      friendlyTime,
      icsUrl: args.icsUrl,
      feeLine,
      callerName: args.callerName ?? null,
      ...(args.askAddress ? { askAddress: true } : {}),
      category: args.operator.category,
      ...(callWindow ? { callWindow } : {}),
    });
    const send = await this.twilio.sendSms({
      from: args.operator.twilio_number_e164,
      to: args.callerPhoneE164,
      body,
    });
    await this.conversations.appendMessage({
      conversationId: args.conversationId,
      role: 'system',
      body: 'sid' in send ? body : `[skipped: ${send.skipped}] ${body}`,
      ...('sid' in send ? { twilioMessageSid: send.sid } : {}),
    });
  }
}
