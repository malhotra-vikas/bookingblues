import { Injectable } from '@nestjs/common';

import { NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { conversationLimitForPlan } from '../billing/plan-limits';

export interface DashboardMetrics {
  readonly month_start_iso: string;
  /** Stats window the numbers below cover (selectable: month/quarter/year/custom). */
  readonly range_start_iso: string;
  readonly range_end_iso: string | null;
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

  async metrics(
    userId: string,
    range?: { startIso: string; endIso?: string },
  ): Promise<DashboardMetrics> {
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, subscription_status, trial_ends_at, plan, current_period_start, current_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new NotFoundError('Operator not found');

    const monthStartIso = startOfMonthUtc().toISOString();
    // Stats window — selectable on the dashboard (month / quarter / year /
    // custom). Defaults to the current calendar month.
    const statsStartIso = range?.startIso ?? monthStartIso;
    const statsEndIso = range?.endIso;

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

    const [convoTotal, convoOutOfScope, convoEscalated, convoActive] = await Promise.all([
      this.count('conversations', operator.id, statsStartIso, undefined, statsEndIso),
      this.count('conversations', operator.id, statsStartIso, { outcome: 'out_of_scope' }, statsEndIso),
      this.count('conversations', operator.id, statsStartIso, { status: 'escalated' }, statsEndIso),
      this.count(
        'conversations',
        operator.id,
        statsStartIso,
        { statusIn: ['awaiting_caller', 'awaiting_bot', 'active'] },
        statsEndIso,
      ),
    ]);

    const [apptTotal, apptConfirmed, apptCompleted, apptCancelled] = await Promise.all([
      this.count('appointments', operator.id, statsStartIso, undefined, statsEndIso),
      this.count('appointments', operator.id, statsStartIso, { status: 'confirmed' }, statsEndIso),
      this.count('appointments', operator.id, statsStartIso, { status: 'completed' }, statsEndIso),
      this.count('appointments', operator.id, statsStartIso, { status: 'cancelled' }, statsEndIso),
    ]);

    // The OPERATOR's "fee collected" is the deposit they keep — the gross charge
    // minus our platform application fee — NOT the platform's cut. (Showing the
    // $37.50 platform fee here confused operators; they want their deposit.)
    let feeQuery = this.supabase
      .db()
      .from('payments')
      .select('amount_cents, application_fee_cents, status, created_at')
      .eq('operator_id', operator.id)
      .gte('created_at', statsStartIso)
      .eq('status', 'succeeded');
    if (statsEndIso) feeQuery = feeQuery.lt('created_at', statsEndIso);
    const { data: feeRows, error: feeErr } = await feeQuery;
    if (feeErr) throw feeErr;
    const feeRevenue = (feeRows ?? []).reduce(
      (sum, r) => sum + ((r.amount_cents ?? 0) - (r.application_fee_cents ?? 0)),
      0,
    );

    return {
      month_start_iso: statsStartIso,
      range_start_iso: statsStartIso,
      range_end_iso: statsEndIso ?? null,
      usage: {
        conversations_used: conversationsUsed,
        conversations_limit: conversationLimitForPlan(operator.plan),
        period_start: periodStartIso,
        period_end: periodEndIso,
      },
      conversations: {
        total: convoTotal,
        // "Booked" = jobs actually on the calendar (confirmed + completed
        // appointments), NOT just conversations with outcome='booked' — a
        // conversation can end abandoned/awaiting while its appointment is
        // confirmed (e.g. paid booking still collecting the address), which
        // undercounted bookings on the dashboard (QA 2026-06-29).
        booked: apptConfirmed + apptCompleted,
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

export type StatsPeriod = 'month' | 'quarter' | 'year' | 'custom';

/**
 * Resolve a dashboard stats window from a period selector. `custom` uses the
 * provided from/to (ISO dates); the others are anchored to the current UTC date.
 * Returns `endIso` only for `custom` (the rolling periods run through "now").
 */
export function computeStatsRange(
  period: StatsPeriod | undefined,
  from?: string,
  to?: string,
): { startIso: string; endIso?: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  switch (period) {
    case 'quarter': {
      const q = Math.floor(now.getUTCMonth() / 3) * 3;
      return { startIso: new Date(Date.UTC(y, q, 1)).toISOString() };
    }
    case 'year':
      return { startIso: new Date(Date.UTC(y, 0, 1)).toISOString() };
    case 'custom': {
      const start = from ? new Date(from) : startOfMonthUtc();
      const result: { startIso: string; endIso?: string } = {
        startIso: Number.isNaN(start.getTime()) ? startOfMonthUtc().toISOString() : start.toISOString(),
      };
      if (to) {
        const end = new Date(to);
        if (!Number.isNaN(end.getTime())) result.endIso = end.toISOString();
      }
      return result;
    }
    case 'month':
    default:
      return { startIso: startOfMonthUtc().toISOString() };
  }
}
