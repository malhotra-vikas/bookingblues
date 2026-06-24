import { Inject, Injectable } from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

export interface SalesActorContext {
  readonly salesUserId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface ClaimedLead {
  readonly lead_user_id: string;
  readonly email: string | null;
  readonly operator_id: string | null;
  readonly business_name: string | null;
  readonly category: string | null;
  readonly subscription_status: string | null;
  readonly onboarding_completed_at: string | null;
  readonly claimed_at: string;
}

/**
 * Sales-rep operations (#4). A rep sees the leads they claimed in #bb-leads
 * (resolved via their linked Slack id) and can generate a scoped impersonation
 * link for those — and ONLY those — operators. Cross-rep access is blocked here,
 * not in the guard.
 */
@Injectable()
export class SalesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditLogService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  /** The Slack user id linked to this sales rep, or null if unlinked. */
  private async slackIdFor(salesUserId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .db()
      .from('sales_slack_links')
      .select('slack_user_id')
      .eq('user_id', salesUserId)
      .maybeSingle();
    if (error) throw error;
    return data?.slack_user_id ?? null;
  }

  async listClaimedLeads(salesUserId: string): Promise<{ data: ClaimedLead[] }> {
    const slackId = await this.slackIdFor(salesUserId);
    if (!slackId) return { data: [] };

    const { data: claims, error } = await this.supabase
      .db()
      .from('lead_claims')
      .select('user_id, claimed_at')
      .eq('claimed_by_slack_user_id', slackId)
      .order('claimed_at', { ascending: false });
    if (error) throw error;
    if (!claims || claims.length === 0) return { data: [] };

    const userIds = claims.map((c) => c.user_id);
    const { data: ops, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('id, user_id, business_name, category, subscription_status, onboarding_completed_at')
      .in('user_id', userIds);
    if (opErr) throw opErr;
    const opByUser = new Map((ops ?? []).map((o) => [o.user_id, o]));

    const data = await Promise.all(
      claims.map(async (c): Promise<ClaimedLead> => {
        const op = opByUser.get(c.user_id);
        const { data: u } = await this.supabase.db().auth.admin.getUserById(c.user_id);
        return {
          lead_user_id: c.user_id,
          email: u?.user?.email ?? null,
          operator_id: op?.id ?? null,
          business_name: op?.business_name ?? null,
          category: op?.category ?? null,
          subscription_status: op?.subscription_status ?? null,
          onboarding_completed_at: op?.onboarding_completed_at ?? null,
          claimed_at: c.claimed_at,
        };
      }),
    );
    return { data };
  }

  /**
   * Generate an impersonation magic link for an operator — but only if the rep
   * claimed that operator's lead. Same link mechanism as admin impersonation,
   * audited under `sales.impersonate`.
   */
  async impersonateOperator(args: {
    operatorId: string;
    reason: string;
    actor: SalesActorContext;
  }): Promise<{ action_link: string }> {
    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, user_id, business_name')
      .eq('id', args.operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!operator) throw new NotFoundError('Operator not found');

    const slackId = await this.slackIdFor(args.actor.salesUserId);
    if (!slackId) {
      throw new ForbiddenError('Your account is not linked to a Slack identity');
    }

    const { data: claim, error: claimErr } = await this.supabase
      .db()
      .from('lead_claims')
      .select('user_id')
      .eq('user_id', operator.user_id)
      .eq('claimed_by_slack_user_id', slackId)
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claim) throw new ForbiddenError('You have not claimed this lead');

    const { data: userResp, error: userErr } = await this.supabase
      .db()
      .auth.admin.getUserById(operator.user_id);
    if (userErr) throw userErr;
    const email = userResp?.user?.email;
    if (!email) {
      throw new ConflictError('Operator user has no email; cannot generate impersonation link');
    }

    const { data, error: linkErr } = await this.supabase.db().auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: `${this.env.APP_URL}/dashboard?impersonating=1` },
    });
    if (linkErr || !data?.properties?.action_link) {
      throw new AppError({
        code: 'sales.impersonate_failed',
        status: 502,
        detail: 'Supabase did not return an action link',
      });
    }

    await this.audit.write({
      actorUserId: args.actor.salesUserId,
      operatorId: operator.id,
      action: 'sales.impersonate',
      resourceType: 'operator',
      resourceId: operator.id,
      metadata: { reason: args.reason, target_user_id: operator.user_id },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });

    return { action_link: data.properties.action_link };
  }
}
