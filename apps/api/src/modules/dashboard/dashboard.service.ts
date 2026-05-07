import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface DashboardMetrics {
  readonly month_start_iso: string;
  readonly conversations: {
    readonly total: number;
    readonly booked: number;
    readonly out_of_scope: number;
    readonly escalated: number;
    readonly active: number;
  };
  readonly appointments: {
    readonly total: number;
    readonly confirmed: number;
    readonly completed: number;
    readonly cancelled: number;
  };
  readonly fee_revenue_cents: number;
  readonly subscription_status: string | null;
}

@Injectable()
export class DashboardService {
  constructor(private readonly supabase: SupabaseService) {}

  async metrics(userId: string): Promise<DashboardMetrics> {
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, subscription_status')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new NotFoundError('Operator not found');

    const monthStart = startOfMonthUtc();
    const monthStartIso = monthStart.toISOString();

    const [convoTotal, convoBooked, convoOutOfScope, convoEscalated, convoActive] =
      await Promise.all([
        this.count('conversations', operator.id, monthStartIso),
        this.count('conversations', operator.id, monthStartIso, { outcome: 'booked' }),
        this.count('conversations', operator.id, monthStartIso, { outcome: 'out_of_scope' }),
        this.count('conversations', operator.id, monthStartIso, { status: 'escalated' }),
        this.count('conversations', operator.id, monthStartIso, {
          statusIn: ['awaiting_caller', 'awaiting_bot', 'active'],
        }),
      ]);

    const [apptTotal, apptConfirmed, apptCompleted, apptCancelled] = await Promise.all([
      this.count('appointments', operator.id, monthStartIso),
      this.count('appointments', operator.id, monthStartIso, { status: 'confirmed' }),
      this.count('appointments', operator.id, monthStartIso, { status: 'completed' }),
      this.count('appointments', operator.id, monthStartIso, { status: 'cancelled' }),
    ]);

    const { data: feeRows, error: feeErr } = await this.supabase
      .db()
      .from('payments')
      .select('application_fee_cents, status, created_at')
      .eq('operator_id', operator.id)
      .gte('created_at', monthStartIso)
      .eq('status', 'succeeded');
    if (feeErr) throw feeErr;
    const feeRevenue = (feeRows ?? []).reduce(
      (sum, r) => sum + (r.application_fee_cents ?? 0),
      0,
    );

    return {
      month_start_iso: monthStartIso,
      conversations: {
        total: convoTotal,
        booked: convoBooked,
        out_of_scope: convoOutOfScope,
        escalated: convoEscalated,
        active: convoActive,
      },
      appointments: {
        total: apptTotal,
        confirmed: apptConfirmed,
        completed: apptCompleted,
        cancelled: apptCancelled,
      },
      fee_revenue_cents: feeRevenue,
      subscription_status: operator.subscription_status,
    };
  }

  private async count(
    table: 'conversations' | 'appointments',
    operatorId: string,
    sinceIso: string,
    filter?: { status?: string; statusIn?: ReadonlyArray<string>; outcome?: string },
  ): Promise<number> {
    let q = this.supabase
      .db()
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId)
      .gte('created_at', sinceIso);
    if (filter?.status) q = q.eq('status', filter.status);
    if (filter?.statusIn) q = q.in('status', [...filter.statusIn]);
    if (filter?.outcome) q = q.eq('outcome', filter.outcome);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }
}

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
