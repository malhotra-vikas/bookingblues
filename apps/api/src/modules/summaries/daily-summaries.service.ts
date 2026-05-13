import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Tables } from '@bookingblues/db-types';

import { EmailService } from '../../common/email/email.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { renderDailySummary } from './email-templates';

type OperatorRow = Tables<'operators'>;

export interface RunDailySummariesResult {
  readonly summary_date: string;
  readonly attempted: number;
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

@Injectable()
export class DailySummariesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(DailySummariesService.name);
  }

  /**
   * Send yesterday's daily summary to every operator. Idempotent — re-running
   * within the same day won't double-send. Designed to be triggered by
   * external cron once per day.
   */
  async runForYesterday(): Promise<RunDailySummariesResult> {
    // We pick yesterday in UTC for the cron-trigger boundary, but each
    // operator's stats are bucketed in their own timezone (see below). UTC
    // here just gives a stable per-day idempotency key.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summaryDate = yesterday.toISOString().slice(0, 10); // YYYY-MM-DD

    const { data: operators, error } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .in('subscription_status', ['trialing', 'active']);
    if (error) throw error;

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const op of operators ?? []) {
      try {
        const result = await this.sendForOperator(op, summaryDate);
        if (result === 'sent') sent += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          { operatorId: op.id, err: (err as Error).message },
          'daily summary failed for operator',
        );
      }
    }

    return {
      summary_date: summaryDate,
      attempted: (operators ?? []).length,
      sent,
      skipped,
      failed,
    };
  }

  private async sendForOperator(
    operator: OperatorRow,
    summaryDate: string,
  ): Promise<'sent' | 'skipped'> {
    // Idempotency claim — partial unique on (operator_id, summary_date).
    // 23505 means "already sent today" → silently skip.
    const { error: claimErr } = await this.supabase
      .db()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('daily_summary_sends' as any)
      .insert({ operator_id: operator.id, summary_date: summaryDate });
    if (claimErr) {
      if (claimErr.code === '23505') return 'skipped';
      throw claimErr;
    }

    // Look up operator email.
    const { data: userResp } = await this.supabase
      .db()
      .auth.admin.getUserById(operator.user_id);
    const toEmail = userResp?.user?.email;
    if (!toEmail) {
      this.logger.warn({ operatorId: operator.id }, 'daily summary: no operator email');
      return 'skipped';
    }

    // Per-operator bucketing in their timezone. Compute [dayStart, dayEnd)
    // in UTC such that the wall-clock day in the operator's timezone is
    // `summaryDate` (yesterday).
    const { dayStartUtc, dayEndUtc, todayStartUtc, todayEndUtc } = computeDayBounds(
      summaryDate,
      operator.timezone,
    );

    const [convStarted, convBooked, convEscalated, convAbandoned, feeRows, todayAppts] =
      await Promise.all([
        this.countRows('conversations', operator.id, 'started_at', dayStartUtc, dayEndUtc),
        this.countRows('conversations', operator.id, 'started_at', dayStartUtc, dayEndUtc, { outcome: 'booked' }),
        this.countRows('conversations', operator.id, 'started_at', dayStartUtc, dayEndUtc, { status: 'escalated' }),
        this.countRows('conversations', operator.id, 'started_at', dayStartUtc, dayEndUtc, { status: 'abandoned' }),
        this.supabase
          .db()
          .from('payments')
          .select('application_fee_cents')
          .eq('operator_id', operator.id)
          .eq('status', 'succeeded')
          .gte('created_at', dayStartUtc)
          .lt('created_at', dayEndUtc),
        this.supabase
          .db()
          .from('appointments')
          .select('caller_name, scheduled_for_start, job_summary')
          .eq('operator_id', operator.id)
          .in('status', ['confirmed', 'proposed'])
          .gte('scheduled_for_start', todayStartUtc)
          .lt('scheduled_for_start', todayEndUtc)
          .order('scheduled_for_start'),
      ]);

    const feeRevenueCents = (feeRows.data ?? []).reduce(
      (sum, r) => sum + (r.application_fee_cents ?? 0),
      0,
    );

    const template = renderDailySummary({
      operator,
      summaryDate,
      conversationsStarted: convStarted,
      conversationsBooked: convBooked,
      conversationsEscalated: convEscalated,
      conversationsAbandoned: convAbandoned,
      feeRevenueCents,
      appointmentsToday: (todayAppts.data ?? []).map((a) => ({
        caller_name: a.caller_name,
        scheduled_for_start: a.scheduled_for_start,
        job_summary: a.job_summary,
      })),
      platformAppUrl: this.env.APP_URL,
    });

    const result = await this.email.send({
      to: toEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    if (!result.delivered) {
      // Roll back the idempotency claim so a future retry can pick this up.
      await this.supabase
        .db()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('daily_summary_sends' as any)
        .delete()
        .eq('operator_id', operator.id)
        .eq('summary_date', summaryDate);
      throw new Error(`email send failed: ${result.reason}`);
    }

    // Stamp the email id for traceability.
    if (result.id) {
      await this.supabase
        .db()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('daily_summary_sends' as any)
        .update({ email_id: result.id })
        .eq('operator_id', operator.id)
        .eq('summary_date', summaryDate);
    }

    return 'sent';
  }

  private async countRows(
    table: 'conversations' | 'appointments',
    operatorId: string,
    timeColumn: string,
    startIso: string,
    endIso: string,
    extra?: { status?: string; outcome?: string },
  ): Promise<number> {
    let qb = this.supabase
      .db()
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', operatorId)
      .gte(timeColumn, startIso)
      .lt(timeColumn, endIso);
    if (extra?.status) qb = qb.eq('status', extra.status);
    if (extra?.outcome) qb = qb.eq('outcome', extra.outcome);
    const { count } = await qb;
    return count ?? 0;
  }
}

/**
 * Convert a YYYY-MM-DD date in the operator's IANA timezone into:
 *   - [dayStartUtc, dayEndUtc): the operator-local day window for the summary
 *   - [todayStartUtc, todayEndUtc): the operator-local "today" (summaryDate+1)
 *
 * Naive but correct for DST: we use Intl.DateTimeFormat to derive the
 * wall-clock offset for the operator on each given local midnight.
 */
function computeDayBounds(
  summaryDate: string,
  tz: string,
): { dayStartUtc: string; dayEndUtc: string; todayStartUtc: string; todayEndUtc: string } {
  const dayStartUtc = localMidnightUtc(summaryDate, tz);
  const next = new Date(`${summaryDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const todayDate = next.toISOString().slice(0, 10);
  const dayEndUtc = localMidnightUtc(todayDate, tz);

  const todayStartUtc = dayEndUtc;
  const dayAfter = new Date(`${todayDate}T00:00:00Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const todayEndUtc = localMidnightUtc(dayAfter.toISOString().slice(0, 10), tz);

  return { dayStartUtc, dayEndUtc, todayStartUtc, todayEndUtc };
}

/**
 * Given a wall-clock date (YYYY-MM-DD) and IANA timezone, return the UTC
 * ISO string for that day's local midnight. Uses the trick of formatting a
 * candidate UTC instant into the target tz and measuring the delta.
 */
function localMidnightUtc(yyyyMmDd: string, tz: string): string {
  // Start with naive UTC midnight, then shift by the tz offset at that moment.
  const candidate = new Date(`${yyyyMmDd}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(candidate);
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value ?? '0');
  const tzMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const offsetMs = tzMs - candidate.getTime();
  return new Date(candidate.getTime() - offsetMs).toISOString();
}
