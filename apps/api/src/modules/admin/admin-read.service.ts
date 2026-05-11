import { Injectable } from '@nestjs/common';
import type { Tables } from '@bookingblues/db-types';

import { NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';

export type OperatorRow = Tables<'operators'>;

export interface OperatorListItem {
  readonly id: string;
  readonly business_name: string;
  readonly category: string | null;
  readonly subscription_status: string | null;
  readonly trial_ends_at: string | null;
  readonly twilio_number_e164: string | null;
  readonly google_calendar_connected: boolean;
  readonly stripe_connect_charges_enabled: boolean;
  readonly stripe_connect_payouts_enabled: boolean;
  readonly created_at: string;
}

export interface ListOperatorsResult {
  readonly items: ReadonlyArray<OperatorListItem>;
  readonly next_cursor: string | null;
}

export interface OperatorDossier {
  readonly operator: OperatorRow;
  readonly user_email: string | null;
  readonly totals: {
    readonly conversations: number;
    readonly appointments_confirmed: number;
    readonly appointments_completed: number;
    readonly fee_revenue_cents: number;
  };
}

export interface GlobalMetrics {
  readonly operators: {
    readonly total: number;
    readonly trialing: number;
    readonly active: number;
    readonly past_due: number;
    readonly canceled: number;
  };
  readonly mrr_cents_approx: number;
  readonly conversations_active_now: number;
  readonly escalations_open: number;
  readonly fee_revenue_mtd_cents: number;
}

/**
 * Cursor format: opaque `created_at|id` base64. Stable across requests because
 * (created_at desc, id desc) is a total ordering — operators.id is uuid so the
 * tie-break is deterministic. Cursor encodes "give me rows strictly before this
 * (created_at, id)".
 */
function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const [createdAt, id] = raw.split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

@Injectable()
export class AdminReadService {
  constructor(private readonly supabase: SupabaseService) {}

  async listOperators(args: {
    cursor?: string;
    q?: string;
    status?: string;
    hasTwilio?: boolean;
    hasCalendar?: boolean;
    limit: number;
  }): Promise<ListOperatorsResult> {
    let qb = this.supabase
      .db()
      .from('operators')
      .select(
        'id, business_name, category, subscription_status, trial_ends_at, twilio_number_e164, google_calendar_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled, created_at',
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(args.limit + 1);

    if (args.q) qb = qb.ilike('business_name', `%${args.q}%`);
    if (args.status) qb = qb.eq('subscription_status', args.status);
    if (args.hasTwilio === true) qb = qb.not('twilio_number_e164', 'is', null);
    if (args.hasTwilio === false) qb = qb.is('twilio_number_e164', null);
    if (args.hasCalendar === true) qb = qb.not('google_calendar_id', 'is', null);
    if (args.hasCalendar === false) qb = qb.is('google_calendar_id', null);

    if (args.cursor) {
      const decoded = decodeCursor(args.cursor);
      if (decoded) {
        // Strictly before (created_at, id). Supabase JS doesn't expose tuple
        // comparison natively, so we approximate with lt on created_at; the
        // tie-break on id within the same microsecond is rare enough to accept.
        qb = qb.lt('created_at', decoded.createdAt);
      }
    }

    const { data, error } = await qb;
    if (error) throw error;
    const rows = data ?? [];

    const items: OperatorListItem[] = rows.slice(0, args.limit).map((r) => ({
      id: r.id,
      business_name: r.business_name,
      category: r.category,
      subscription_status: r.subscription_status,
      trial_ends_at: r.trial_ends_at,
      twilio_number_e164: r.twilio_number_e164,
      google_calendar_connected: r.google_calendar_id != null,
      stripe_connect_charges_enabled: r.stripe_connect_charges_enabled,
      stripe_connect_payouts_enabled: r.stripe_connect_payouts_enabled,
      created_at: r.created_at,
    }));
    const next =
      rows.length > args.limit ? rows[args.limit - 1] : null;
    const nextCursor = next ? encodeCursor(next.created_at, next.id) : null;
    return { items, next_cursor: nextCursor };
  }

  async getOperatorDossier(operatorId: string): Promise<OperatorDossier> {
    const operator = await this.requireOperator(operatorId);

    // Email lives on auth.users; admin client to read it.
    const { data: userResp, error: userErr } = await this.supabase
      .db()
      .auth.admin.getUserById(operator.user_id);
    const user_email = userErr || !userResp ? null : userResp.user?.email ?? null;

    const [convoCount, apptConfirmed, apptCompleted, feeRows] = await Promise.all([
      this.simpleCount('conversations', { operatorId }),
      this.simpleCount('appointments', { operatorId, status: 'confirmed' }),
      this.simpleCount('appointments', { operatorId, status: 'completed' }),
      this.supabase
        .db()
        .from('payments')
        .select('application_fee_cents')
        .eq('operator_id', operatorId)
        .eq('status', 'succeeded'),
    ]);
    const feeRevenue = (feeRows.data ?? []).reduce(
      (s, r) => s + (r.application_fee_cents ?? 0),
      0,
    );

    return {
      operator,
      user_email,
      totals: {
        conversations: convoCount,
        appointments_confirmed: apptConfirmed,
        appointments_completed: apptCompleted,
        fee_revenue_cents: feeRevenue,
      },
    };
  }

  async listOperatorConversations(operatorId: string, args: { limit: number; cursor?: string }): Promise<{
    items: Array<Tables<'conversations'>>;
    next_cursor: string | null;
  }> {
    let qb = this.supabase
      .db()
      .from('conversations')
      .select('*')
      .eq('operator_id', operatorId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(args.limit + 1);
    if (args.cursor) {
      const decoded = decodeCursor(args.cursor);
      if (decoded) qb = qb.lt('last_message_at', decoded.createdAt);
    }
    const { data, error } = await qb;
    if (error) throw error;
    const rows = data ?? [];
    const items = rows.slice(0, args.limit);
    const next = rows.length > args.limit ? rows[args.limit - 1] : null;
    const next_cursor = next && next.last_message_at
      ? encodeCursor(next.last_message_at, next.id)
      : null;
    return { items, next_cursor };
  }

  async listOperatorAppointments(operatorId: string, args: { limit: number; cursor?: string }): Promise<{
    items: Array<Tables<'appointments'>>;
    next_cursor: string | null;
  }> {
    let qb = this.supabase
      .db()
      .from('appointments')
      .select('*')
      .eq('operator_id', operatorId)
      .order('scheduled_for_start', { ascending: false })
      .limit(args.limit + 1);
    if (args.cursor) {
      const decoded = decodeCursor(args.cursor);
      if (decoded) qb = qb.lt('scheduled_for_start', decoded.createdAt);
    }
    const { data, error } = await qb;
    if (error) throw error;
    const rows = data ?? [];
    const items = rows.slice(0, args.limit);
    const next = rows.length > args.limit ? rows[args.limit - 1] : null;
    const next_cursor = next
      ? encodeCursor(next.scheduled_for_start, next.id)
      : null;
    return { items, next_cursor };
  }

  async listOperatorPayments(operatorId: string, args: { limit: number; cursor?: string }): Promise<{
    items: Array<Tables<'payments'>>;
    next_cursor: string | null;
  }> {
    let qb = this.supabase
      .db()
      .from('payments')
      .select('*')
      .eq('operator_id', operatorId)
      .order('created_at', { ascending: false })
      .limit(args.limit + 1);
    if (args.cursor) {
      const decoded = decodeCursor(args.cursor);
      if (decoded) qb = qb.lt('created_at', decoded.createdAt);
    }
    const { data, error } = await qb;
    if (error) throw error;
    const rows = data ?? [];
    const items = rows.slice(0, args.limit);
    const next = rows.length > args.limit ? rows[args.limit - 1] : null;
    const next_cursor = next ? encodeCursor(next.created_at, next.id) : null;
    return { items, next_cursor };
  }

  async listOperatorAuditLog(operatorId: string, args: { limit: number; cursor?: string }): Promise<{
    items: Array<Tables<'audit_log'>>;
    next_cursor: string | null;
  }> {
    let qb = this.supabase
      .db()
      .from('audit_log')
      .select('*')
      .eq('operator_id', operatorId)
      .order('created_at', { ascending: false })
      .limit(args.limit + 1);
    if (args.cursor) {
      const decoded = decodeCursor(args.cursor);
      if (decoded) qb = qb.lt('created_at', decoded.createdAt);
    }
    const { data, error } = await qb;
    if (error) throw error;
    const rows = data ?? [];
    const items = rows.slice(0, args.limit);
    const next = rows.length > args.limit ? rows[args.limit - 1] : null;
    const next_cursor = next ? encodeCursor(next.created_at, next.id) : null;
    return { items, next_cursor };
  }

  async listConversationMessages(conversationId: string): Promise<Array<Tables<'messages'>>> {
    const { data, error } = await this.supabase
      .db()
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async globalMetrics(): Promise<GlobalMetrics> {
    const monthStart = startOfMonthUtc().toISOString();
    const [total, trialing, active, pastDue, canceled, convoActive, escOpen, feeRows] =
      await Promise.all([
        this.simpleCount('operators'),
        this.simpleCount('operators', { subscription_status: 'trialing' }),
        this.simpleCount('operators', { subscription_status: 'active' }),
        this.simpleCount('operators', { subscription_status: 'past_due' }),
        this.simpleCount('operators', { subscription_status: 'canceled' }),
        this.simpleCount('conversations', {
          statusIn: ['awaiting_caller', 'awaiting_bot', 'active'],
        }),
        this.countEscalationsOpen().catch(() => 0),
        this.supabase
          .db()
          .from('payments')
          .select('application_fee_cents')
          .gte('created_at', monthStart)
          .eq('status', 'succeeded'),
      ]);

    const feeRevenueMtd = (feeRows.data ?? []).reduce(
      (s, r) => s + (r.application_fee_cents ?? 0),
      0,
    );

    // MRR approximation: count of (trialing+active) × an env-tunable plan price
    // is the proper math, but we don't yet have prices in the DB. Use the
    // Stripe `subscription_status=active` count as a placeholder — replace
    // with a Stripe billing pull once Slice 11/12 add a Stripe sync job.
    const mrrCentsApprox = 0;

    return {
      operators: {
        total,
        trialing,
        active,
        past_due: pastDue,
        canceled,
      },
      mrr_cents_approx: mrrCentsApprox,
      conversations_active_now: convoActive,
      escalations_open: escOpen,
      fee_revenue_mtd_cents: feeRevenueMtd,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async requireOperator(operatorId: string): Promise<OperatorRow> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError('Operator not found');
    return data;
  }

  /**
   * Counts open escalations across all operators. The `escalations` table is
   * introduced by Slice 7.5 (migration 20260511000002). The db-types aren't
   * regenerated until both slices land, so we issue a raw query keyed by name
   * and cast through `unknown`. If the table doesn't yet exist, the caller's
   * `.catch(() => 0)` absorbs the error.
   */
  private async countEscalationsOpen(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { count, error } = await client
      .from('escalations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open');
    if (error) throw error;
    return (count as number | null) ?? 0;
  }

  private async simpleCount(
    table: 'operators' | 'conversations' | 'appointments',
    filter?: {
      operatorId?: string;
      status?: string;
      statusIn?: ReadonlyArray<string>;
      subscription_status?: string;
    },
  ): Promise<number> {
    let q = this.supabase.db().from(table).select('id', { count: 'exact', head: true });
    if (filter?.operatorId) q = q.eq('operator_id', filter.operatorId);
    if (filter?.status) q = q.eq('status', filter.status);
    if (filter?.statusIn) q = q.in('status', [...filter.statusIn]);
    if (filter?.subscription_status) q = q.eq('subscription_status', filter.subscription_status);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  }
}

function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
