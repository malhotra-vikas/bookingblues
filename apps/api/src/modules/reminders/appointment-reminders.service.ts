import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { ConversationsService } from '../conversations/conversations.service';
import { appointmentReminderSms } from '../conversations/templates/sms-templates';

type OperatorRow = Tables<'operators'>;

/**
 * How far ahead of an appointment we send the reminder. The cron is expected to
 * run more frequently than this (e.g. every 15 min); the first run in which an
 * appointment falls inside the window sends it, then `reminder_sent_at` is
 * stamped so later runs skip it (CLAUDE.md §9.6).
 *
 * TEMPORARY: 60 min for same-day testing of the new reschedule-routing copy.
 * Flip to `24 * 60` (24h) once verified. A booking made inside the window gets
 * its reminder on the next cron run (every 15 min in prod) — correct.
 */
const REMINDER_LEAD_MINUTES = 24 * 60;

export interface RunRemindersResult {
  readonly window_minutes: number;
  readonly attempted: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

@Injectable()
export class AppointmentRemindersService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AppointmentRemindersService.name);
  }

  /**
   * Send the pre-appointment reminder (REMINDER_LEAD_MINUTES) for every
   * confirmed, upcoming appointment
   * that hasn't been reminded yet. Idempotent: each appointment is stamped with
   * `reminder_sent_at` once handled, so re-running (or a cron retry burst) won't
   * double-send. Designed to be triggered by external cron.
   */
  async runDue(): Promise<RunRemindersResult> {
    const now = new Date();
    const nowIso = now.toISOString();
    const windowEndIso = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000).toISOString();

    const { data: due, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, operator_id, caller_phone_e164, conversation_id, scheduled_for_start')
      .eq('status', 'confirmed')
      .is('reminder_sent_at', null)
      .gt('scheduled_for_start', nowIso)
      .lte('scheduled_for_start', windowEndIso);
    if (error) throw error;

    const appointments = due ?? [];
    if (appointments.length === 0) {
      return { window_minutes: REMINDER_LEAD_MINUTES, attempted: 0, sent: 0, skipped: 0, failed: 0 };
    }

    // Batch-load the operators referenced by this window (business name +
    // timezone for the reminder text, sender number for the SMS).
    const operatorIds = [...new Set(appointments.map((a) => a.operator_id))];
    const { data: operators, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .in('id', operatorIds);
    if (opErr) throw opErr;
    const operatorById = new Map<string, OperatorRow>((operators ?? []).map((o) => [o.id, o]));

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const appt of appointments) {
      const operator = operatorById.get(appt.operator_id);
      if (!operator || !operator.twilio_number_e164) {
        // Can't send without a sender number — leave unstamped so it's retried
        // if the operator's number is (re)provisioned before the appointment.
        this.logger.warn(
          { appointmentId: appt.id, operatorId: appt.operator_id },
          'reminder skipped: operator missing or has no Twilio number',
        );
        skipped += 1;
        continue;
      }

      const friendlyTime = new Date(appt.scheduled_for_start).toLocaleString('en-US', {
        timeZone: operator.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      // Direct reschedule/cancel to the operator's registered business number —
      // the AI doesn't handle those (see appointmentReminderSms).
      const body = appointmentReminderSms(
        operator.business_name,
        friendlyTime,
        operator.personal_phone_e164,
      );

      try {
        const send = await this.twilio.sendSms({
          from: operator.twilio_number_e164,
          to: appt.caller_phone_e164,
          body,
        });

        // Sent OR terminally skipped (allowlist/opted-out) → stamp so we don't
        // retry. Only a thrown error (transient) leaves it unstamped.
        await this.supabase
          .db()
          .from('appointments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', appt.id);

        if (appt.conversation_id) {
          await this.conversations.appendMessage({
            conversationId: appt.conversation_id,
            role: 'system',
            body: 'sid' in send ? body : `[skipped: ${send.skipped}] ${body}`,
            ...('sid' in send ? { twilioMessageSid: send.sid } : {}),
          });
        }

        if ('sid' in send) sent += 1;
        else skipped += 1;
      } catch (err) {
        this.logger.error(
          { appointmentId: appt.id, err: (err as Error).message },
          'reminder send failed — will retry on next cron run',
        );
        failed += 1;
      }
    }

    this.logger.info(
      { window_minutes: REMINDER_LEAD_MINUTES, attempted: appointments.length, sent, skipped, failed },
      'appointment reminders run complete',
    );
    return { window_minutes: REMINDER_LEAD_MINUTES, attempted: appointments.length, sent, skipped, failed };
  }
}
