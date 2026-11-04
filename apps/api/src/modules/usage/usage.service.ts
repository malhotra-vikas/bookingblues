import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  type OverLimitPolicy,
  conversationLimitForPlan,
  overLimitPolicyForPlan,
  thresholdsReached,
} from '../billing/plan-limits';
import { usageAlertEmail } from './usage-emails';
import { UsageNotifierService } from './usage-notifier.service';
import { type UsageWindow, usageWindow } from './usage-window';

/** The operator columns usage needs. A full `operators` row satisfies it. */
export interface UsageOperator {
  readonly id: string;
  readonly user_id: string;
  readonly business_name: string;
  readonly plan: string | null;
  readonly current_period_start: string | null;
  /** Stamped on each counted person: trial windows are never billed for overage. */
  readonly subscription_status?: string | null;
}

export interface UsageSummary {
  readonly used: number;
  readonly limit: number | null;
  readonly policy: OverLimitPolicy | null;
  readonly window: UsageWindow;
}

export interface Admission extends UsageSummary {
  /** False only for a NEW person on a blocking plan (Solo) that is at its limit. */
  readonly allowed: boolean;
}

/**
 * Usage metering (#usage-metering). A plan's limit counts UNIQUE PEOPLE the AI
 * talks to per monthly window (usage-window.ts). A person is counted the first
 * time the AI engages them in a window (their first text it processes); calls
 * that never text back don't count. `usage_callers` holds one row per person per
 * window — its unique key is the counter.
 *
 * Known v1 limitation: admission isn't serialized, so two brand-new people
 * arriving in the same instant at 79/80 can both be admitted (81/80). Same
 * trade-off as the booking capacity check; fine at current volume.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifier: UsageNotifierService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UsageService.name);
  }

  /**
   * Count this person against the operator's window, or refuse them if the plan
   * blocks at its limit. Sends the 80% / 100% alerts when a threshold is crossed.
   */
  async admitCaller(operator: UsageOperator, callerPhoneE164: string, now = new Date()): Promise<Admission> {
    const check = await this.check(operator, callerPhoneE164, now);
    if (check.counted || !check.allowed) return check;

    const { error } = await this.supabase
      .db()
      .from('usage_callers')
      .upsert(
        {
          operator_id: operator.id,
          window_start: check.window.start.toISOString(),
          caller_phone_e164: callerPhoneE164,
          // Overage is billed at the plan this person was counted under, even
          // after a downgrade/cancel (usage-billing.service reconcileOverage).
          plan: operator.plan,
          in_trial: operator.subscription_status === 'trialing',
        },
        { onConflict: 'operator_id,window_start,caller_phone_e164', ignoreDuplicates: true },
      );
    if (error) throw error;

    const used = await this.countPeople(operator.id, check.window.start);
    if (check.limit != null && check.policy != null) {
      await this.alertIfCrossed(operator, check.window, used, check.limit, check.policy);
    }
    return { ...check, used };
  }

  /** Would this person be let in right now? Read-only (used before the opening SMS). */
  async wouldAdmit(operatorId: string, callerPhoneE164: string, now = new Date()): Promise<boolean> {
    const operator = await this.loadOperator(operatorId);
    if (!operator) return true;
    return (await this.check(operator, callerPhoneE164, now)).allowed;
  }

  async summary(operator: UsageOperator, now = new Date()): Promise<UsageSummary> {
    const window = usageWindow(operator.current_period_start, now);
    return {
      used: await this.countPeople(operator.id, window.start),
      limit: conversationLimitForPlan(operator.plan),
      policy: overLimitPolicyForPlan(operator.plan),
      window,
    };
  }

  /** People counted in one window. */
  async countPeople(operatorId: string, windowStart: Date): Promise<number> {
    const { count, error } = await this.supabase
      .db()
      .from('usage_callers')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId)
      .eq('window_start', windowStart.toISOString());
    if (error) throw error;
    return count ?? 0;
  }

  /**
   * Distinct people across every window that STARTED in [from, to). Used to
   * bill a Stripe billing period, which normally holds exactly one window.
   */
  async countPeopleInRange(operatorId: string, from: Date, to: Date): Promise<number> {
    const { data, error } = await this.supabase
      .db()
      .from('usage_callers')
      .select('caller_phone_e164')
      .eq('operator_id', operatorId)
      .gte('window_start', from.toISOString())
      .lt('window_start', to.toISOString());
    if (error) throw error;
    return new Set((data ?? []).map((r) => r.caller_phone_e164)).size;
  }

  private async check(
    operator: UsageOperator,
    callerPhoneE164: string,
    now: Date,
  ): Promise<Admission & { counted: boolean }> {
    const window = usageWindow(operator.current_period_start, now);
    const limit = conversationLimitForPlan(operator.plan);
    const policy = overLimitPolicyForPlan(operator.plan);

    const { data: existing, error } = await this.supabase
      .db()
      .from('usage_callers')
      .select('id')
      .eq('operator_id', operator.id)
      .eq('window_start', window.start.toISOString())
      .eq('caller_phone_e164', callerPhoneE164)
      .maybeSingle();
    if (error) throw error;

    const used = await this.countPeople(operator.id, window.start);
    // Someone already counted this window keeps the AI, even past the limit.
    if (existing) return { allowed: true, counted: true, used, limit, policy, window };
    const allowed = !(policy === 'block' && limit != null && used >= limit);
    return { allowed, counted: false, used, limit, policy, window };
  }

  private async alertIfCrossed(
    operator: UsageOperator,
    window: UsageWindow,
    used: number,
    limit: number,
    policy: OverLimitPolicy,
  ): Promise<void> {
    for (const threshold of thresholdsReached(used, limit)) {
      // The unique row is the "already sent" flag: one email per threshold per window.
      const { error } = await this.supabase.db().from('usage_alerts').insert({
        operator_id: operator.id,
        window_start: window.start.toISOString(),
        threshold_pct: threshold,
      });
      if (error) {
        if (error.code === '23505') continue;
        throw error;
      }
      this.logger.info({ operatorId: operator.id, threshold, used, limit }, 'usage threshold reached');
      try {
        await this.notifier.send(
          `usage_${threshold}`,
          {
            id: operator.id,
            businessName: operator.business_name,
            plan: operator.plan,
            userId: operator.user_id,
          },
          usageAlertEmail({
            operator: { id: operator.id, businessName: operator.business_name, plan: operator.plan },
            threshold,
            used,
            limit,
            policy,
            resetsAt: window.end,
            appUrl: this.notifier.appUrl,
          }),
        );
      } catch (err) {
        // Never fail the caller's conversation over an alert email.
        this.logger.error(
          { operatorId: operator.id, threshold, err: (err as Error).message },
          'usage alert failed to send',
        );
      }
    }
  }

  private async loadOperator(operatorId: string): Promise<UsageOperator | null> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, user_id, business_name, plan, current_period_start')
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
