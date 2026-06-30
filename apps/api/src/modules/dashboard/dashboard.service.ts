import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { conversationLimitForPlan } from '../billing/plan-limits';

export interface DashboardMetrics {
  readonly month_start_iso: string;
  /**
   * Conversation usage for the operator's current billing cycle (#usage). For
   * trials the window spans the trial; for paid it's the Stripe billing period.
   * Falls back to the calendar month if the period isn't synced yet.
   */
  readonly usage: {
    readonly conversations_used: number;
    readonly conversations_limit: number | null;
    readonly period_start: string;
    readonly period_end: string | null;
  };
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
  readonly trial_ends_at: string | null;
}

@Injectable()
export class DashboardService {
  constructor(private readonly supabase: SupabaseService) {}

  async metrics(userId: string): Promise<DashboardMetrics> {
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, subscription_status, trial_ends_at, plan, current_period_start, current_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new NotFoundError('Operator not found');

    const monthStart = startOfMonthUtc();
    const monthStartIso = monthStart.toISOString();

    // Usage window: the operator's current billing cycle (covers trials too).
    // Fall back to the calendar month if the subscription period isn't synced.
    const periodStartIso = operator.current_period_start ?? monthStartIso;
    const periodEndIso = operator.current_period_end ?? null;
    const conversationsUsed = await this.count(
      'conversations',
      operator.id,
      periodStartIso,
      undefined,
      periodEndIso ?? undefined,
    );

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

    // The OPERATOR's "fee collected" is the deposit they keep — the gross charge
    // minus our platform application fee — NOT the platform's cut. (Showing the
    // $37.50 platform fee here confused operators; they want their deposit.)
    const { data: feeRows, error: feeErr } = await this.supabase
      .db()
      .from('payments')
      .select('amount_cents, application_fee_cents, status, created_at')
      .eq('operator_id', operator.id)
      .gte('created_at', monthStartIso)
      .eq('status', 'succeeded');
    if (feeErr) throw feeErr;
    const feeRevenue = (feeRows ?? []).reduce(
      (sum, r) => sum + ((r.amount_cents ?? 0) - (r.application_fee_cents ?? 0)),
      0,
    );

    return {
      month_start_iso: monthStartIso,
      usage: {
        conversations_used: conversationsUsed,
        conversations_limit: conversationLimitForPlan(operator.plan),
        period_start: periodStartIso,
        period_end: periodEndIso,
      },
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
      trial_ends_at: operator.trial_ends_at,
    };
  }

  private async count(
    table: 'conversations' | 'appointments',
    operatorId: string,
    sinceIso: string,
    filter?: { status?: string; statusIn?: ReadonlyArray<string>; outcome?: string },
    untilIso?: string,
  ): Promise<number> {
    let q = this.supabase
      .db()
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId)
      .gte('created_at', sinceIso);
    if (untilIso) q = q.lt('created_at', untilIso);
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
