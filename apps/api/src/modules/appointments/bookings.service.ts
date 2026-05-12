import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { ConflictError, ValidationError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { CalendarService } from '../calendar/calendar.service';
import { ConversationsService } from '../conversations/conversations.service';

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
 *   - DB insert with the partial unique index race protection
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
  }): Promise<BookResult> {
    if (new Date(args.endIso).getTime() <= new Date(args.startIso).getTime()) {
      throw new ValidationError('Appointment end must be after start');
    }

    // 1. Insert appointment row. Partial unique index on
    //    (operator_id, scheduled_for_start) where status in ('proposed','confirmed')
    //    prevents two callers winning the same slot (CLAUDE.md §17).
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

    // 2. Google Calendar event — roll back the appointment if Google rejects
    //    so we never leave a phantom booking the operator can't see.
    let operatorEventUrl: string | null = null;
    try {
      const calendarRes = await this.calendar.insertEvent({
        operatorId: args.operator.id,
        summary: `${args.operator.business_name}: ${args.jobSummary.slice(0, 80)}`,
        description: this.eventDescription(args),
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

    const icsUrl = this.icsUrl(appointmentId);

    // 3. Confirmation SMS to caller with a tap-to-add calendar link. The
    //    operator gets their own event in Google Calendar via the insertEvent
    //    above. Failure to send the SMS is non-fatal — the appointment is
    //    booked DB+calendar-side; we log and continue.
    if (args.conversationId) {
      await this.sendConfirmationSms({
        operator: args.operator,
        conversationId: args.conversationId,
        callerPhoneE164: args.callerPhoneE164,
        startIso: args.startIso,
        icsUrl,
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
        },
      });
    }

    return { appointmentId, icsUrl, operatorEventUrl };
  }

  /** Public, unauthenticated deep-link the caller can tap to add to their calendar. */
  icsUrl(appointmentId: string): string {
    return `${this.env.API_URL}/v1/appointments/${appointmentId}.ics`;
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
      'PRODID:-//BookingBlues//EN',
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

  private eventDescription(args: {
    callerName: string;
    callerPhoneE164: string;
    urgency?: Urgency;
    jobSummary: string;
  }): string {
    const urgency = args.urgency ?? 'normal';
    return `Caller: ${args.callerName} ${args.callerPhoneE164}\nUrgency: ${urgency}\n\n${args.jobSummary}`;
  }

  private async sendConfirmationSms(args: {
    operator: OperatorRow;
    conversationId: string;
    callerPhoneE164: string;
    startIso: string;
    icsUrl: string;
  }): Promise<void> {
    if (!args.operator.twilio_number_e164) return;
    const friendlyTime = new Date(args.startIso).toLocaleString('en-US', {
      timeZone: args.operator.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    const body =
      `✅ You're booked with ${args.operator.business_name} for ${friendlyTime}. ` +
      `Add to your calendar: ${args.icsUrl}`;
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
