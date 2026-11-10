import { Injectable } from '@nestjs/common';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { isOfficeAppointmentCategory } from '../ai/category-profile';
import { type CalendarEvent, eventForAppointment } from './calendar-link';

export interface CalendarLookup {
  /** Null when the appointment doesn't exist or was cancelled. */
  readonly event: CalendarEvent | null;
  readonly businessName: string | null;
  readonly timezone: string | null;
  readonly office: boolean;
  /** The operator's registered business number, for "call us" on the unavailable page. */
  readonly businessPhoneE164: string | null;
}

/** Loads what the "add to calendar" endpoints need for one appointment. */
@Injectable()
export class CalendarLinkService {
  constructor(private readonly supabase: SupabaseService) {}

  async lookup(appointmentId: string): Promise<CalendarLookup> {
    const empty: CalendarLookup = { event: null, businessName: null, timezone: null, office: false, businessPhoneE164: null };
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId)) return empty;

    const { data: appt, error } = await this.supabase
      .db()
      .from('appointments')
      .select('id, job_summary, scheduled_for_start, scheduled_for_end, service_address, status, operator_id')
      .eq('id', appointmentId)
      .maybeSingle();
    if (error) throw error;
    if (!appt) return empty;

    const { data: op, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('business_name, timezone, category, personal_phone_e164')
      .eq('id', appt.operator_id)
      .maybeSingle();
    if (opErr) throw opErr;
    if (!op) return empty;

    const office = isOfficeAppointmentCategory(op.category);
    const base = {
      businessName: op.business_name,
      timezone: op.timezone,
      office,
      businessPhoneE164: op.personal_phone_e164,
    };
    if (appt.status === 'cancelled') return { ...base, event: null };
    return {
      ...base,
      event: eventForAppointment(
        {
          id: appt.id,
          jobSummary: appt.job_summary,
          startIso: appt.scheduled_for_start,
          endIso: appt.scheduled_for_end,
          serviceAddress: appt.service_address,
        },
        { businessName: op.business_name, timezone: op.timezone, office },
      ),
    };
  }
}
