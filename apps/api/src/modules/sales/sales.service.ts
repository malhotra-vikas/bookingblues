import { Inject, Injectable } from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { impersonationConfirmLink } from '../../common/auth/impersonation-link';
import { brandedEmailHtml, escapeHtml } from '../../common/email/email-layout';
import { EmailService } from '../../common/email/email.service';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { buildLeadBlocks } from '../leads/leads.controller';
import { SlackApiClient } from '../slack/slack-api.client';

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
    private readonly email: EmailService,
    private readonly slack: SlackApiClient,
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
    if (linkErr || !data?.properties?.hashed_token) {
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

    return { action_link: impersonationConfirmLink(this.env.APP_URL, data.properties.hashed_token) };
  }

  /** Slack id + username for a rep, or null if unlinked. */
  private async slackLinkFor(
    salesUserId: string,
  ): Promise<{ slackUserId: string; slackUsername: string | null } | null> {
    const { data, error } = await this.supabase
      .db()
      .from('sales_slack_links')
      .select('slack_user_id, slack_username')
      .eq('user_id', salesUserId)
      .maybeSingle();
    if (error) throw error;
    return data ? { slackUserId: data.slack_user_id, slackUsername: data.slack_username } : null;
  }

  /**
   * A sales rep onboards a new client on their behalf. Creates a ready-to-use
   * account: a confirmed auth user (with the rep-chosen password), a trialing
   * operator row (business name + mobile pre-filled), and the lead auto-claimed
   * for the rep — so it shows immediately with a business name, "Trial" status,
   * and a working "Login as". A branded KeeprSteady welcome email is sent (not
   * the raw Supabase invite).
   */
  async createLead(args: {
    email: string;
    businessName: string;
    phoneE164: string;
    password: string;
    actor: SalesActorContext;
  }): Promise<{ lead_user_id: string; operator_id: string; email: string }> {
    const link = await this.slackLinkFor(args.actor.salesUserId);
    if (!link) {
      throw new ForbiddenError(
        'Your account is not linked to a Slack identity yet — an admin must link it before you can add clients.',
      );
    }

    // Create a confirmed account so the client (and the rep via Login-as) can
    // sign in immediately. email_confirm:true skips the verification round-trip.
    const { data, error } = await this.supabase.db().auth.admin.createUser({
      email: args.email,
      password: args.password,
      email_confirm: true,
      user_metadata: { business_name: args.businessName, personal_phone_e164: args.phoneE164 },
    });
    if (error || !data?.user) {
      const already = /already|registered|exists|duplicate/i.test(error?.message ?? '');
      throw new AppError({
        code: already ? 'sales.lead_email_taken' : 'sales.lead_create_failed',
        status: already ? 409 : 502,
        detail: already
          ? 'That email already has a KeeprSteady account — it may already be a lead or an existing operator.'
          : `Could not create the client account: ${error?.message ?? 'unknown error'}`,
      });
    }
    const leadUserId = data.user.id;

    // Create the operator row up front, on a free trial, so the lead is
    // actionable right away (business name, Trial status, Login-as all work).
    const trialEndsAt = new Date(Date.now() + this.env.TRIAL_DAYS * 86_400_000).toISOString();
    const { data: op, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .insert({
        user_id: leadUserId,
        business_name: args.businessName,
        personal_phone_e164: args.phoneE164,
        subscription_status: 'trialing',
        trial_ends_at: trialEndsAt,
      })
      .select('id')
      .single();
    if (opErr || !op) {
      throw new AppError({
        code: 'sales.lead_operator_failed',
        status: 502,
        detail: `Client account created but operator setup failed: ${opErr?.message ?? 'unknown'}`,
      });
    }

    const { error: claimErr } = await this.supabase
      .db()
      .from('lead_claims')
      .upsert(
        {
          user_id: leadUserId,
          claimed_by_slack_user_id: link.slackUserId,
          claimed_by_slack_username: link.slackUsername,
          claimed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (claimErr) {
      throw new AppError({
        code: 'sales.lead_claim_failed',
        status: 502,
        detail: `Client account created but auto-assign failed: ${claimErr.message}`,
      });
    }

    // Branded welcome email (best-effort — never fail the creation over email).
    await this.email
      .send({
        to: args.email,
        subject: `Welcome to KeeprSteady, ${args.businessName}!`,
        html: this.welcomeHtml(args.businessName),
        text:
          `Welcome to KeeprSteady, ${args.businessName}!\n\n` +
          `Your account is ready and you're on a free ${this.env.TRIAL_DAYS}-day trial. ` +
          `Log in at ${this.env.APP_URL}/login with ${args.email} and the password your rep set — ` +
          `you can change it anytime in Settings.\n\nFinish setup: ${this.env.APP_URL}/onboarding`,
        ...(this.env.EMAIL_FROM ? { replyTo: this.env.EMAIL_FROM } : {}),
      })
      .catch(() => undefined);

    // Announce in #new-leads so the whole team sees it — pre-assigned to the
    // creating rep (no Claim button; it's already theirs). Best-effort.
    await this.postLeadToSlack({
      leadUserId,
      email: args.email,
      businessName: args.businessName,
      phoneE164: args.phoneE164,
      preassignedSlackUserId: link.slackUserId,
    }).catch(() => undefined);

    await this.audit.write({
      actorUserId: args.actor.salesUserId,
      operatorId: op.id,
      action: 'sales.lead_create',
      resourceType: 'operator',
      resourceId: op.id,
      metadata: { email: args.email, business_name: args.businessName, slack_user_id: link.slackUserId },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });

    return { lead_user_id: leadUserId, operator_id: op.id, email: args.email };
  }

  /** Post a rep-created lead to #new-leads, pre-assigned to the creating rep. */
  private async postLeadToSlack(args: {
    leadUserId: string;
    email: string;
    businessName: string;
    phoneE164: string;
    preassignedSlackUserId: string;
  }): Promise<void> {
    const channel = this.slack.leadsChannelId();
    if (!this.slack.isConfigured() || !channel) return;
    const adminUrl = `${this.env.APP_URL.replace(/\/$/, '')}/admin/leads`;
    await this.slack.postMessage({
      channel,
      text: `New lead: ${args.businessName} · added by <@${args.preassignedSlackUserId}>`,
      blocks: buildLeadBlocks({
        userId: args.leadUserId,
        email: args.email,
        businessName: args.businessName,
        phoneE164: args.phoneE164,
        adminUrl,
        headline: `:tada: *New lead (added by a rep)* — *${args.businessName}*`,
        preassignedSlackUserId: args.preassignedSlackUserId,
      }),
    });
  }

  private welcomeHtml(businessName: string): string {
    return brandedEmailHtml({
      heading: `Welcome to KeeprSteady, ${escapeHtml(businessName)}! 🎉`,
      bodyHtml:
        `<p style="margin:0 0 12px;">Your account is set up and you're on a <strong>free ${this.env.TRIAL_DAYS}-day trial</strong> — no charge yet.</p>` +
        `<p style="margin:0;">KeeprSteady texts back the calls you miss, books the job, and drops it on your calendar. Let's finish setting you up:</p>`,
      cta: { label: 'Log in & finish setup →', href: `${this.env.APP_URL}/login` },
      footnoteHtml:
        'Your sales rep set an initial password for you — you can change it anytime in Settings. Questions? Just reply to this email.',
    });
  }
}
