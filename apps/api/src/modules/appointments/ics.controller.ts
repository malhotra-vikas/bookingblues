import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { BookingsService } from './bookings.service';

/**
 * Public ICS endpoint. The link goes out in the confirmation SMS so the
 * caller can tap-to-add the appointment to Apple Calendar / Google Calendar
 * / Outlook from their phone. UUID-only auth is acceptable for MVP — the
 * appointment ID is 122 bits of entropy and the only data exposed (start
 * time, operator name, the caller's own job summary + last-4) is already
 * known to the caller. Revisit if we ever surface attendee emails or
 * fee amounts in the ICS.
 */
@Controller()
@SkipThrottle()
export class IcsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly bookings: BookingsService,
  ) {}

  @Get('v1/appointments/:id.ics')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'inline; filename="appointment.ics"')
  async getIcs(@Param('id', new ParseUUIDPipe()) id: string): Promise<string> {
    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, caller_phone_e164, job_summary, scheduled_for_start, scheduled_for_end, status, operator_id')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!appt || appt.status === 'cancelled') {
      throw new NotFoundException('Appointment not found');
    }
    const { data: op, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('business_name')
      .eq('id', appt.operator_id)
      .single();
    if (opErr) throw opErr;
    return this.bookings.buildIcsBody({
      appointmentId: appt.id,
      operatorName: op.business_name,
      jobSummary: appt.job_summary,
      startIso: appt.scheduled_for_start,
      endIso: appt.scheduled_for_end,
      callerPhoneE164: appt.caller_phone_e164,
    });
  }
}
