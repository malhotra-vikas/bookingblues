import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';
import type { Database } from '@bookingblues/db-types';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { impersonationConfirmLink } from '../../common/auth/impersonation-link';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PaymentsService } from '../payments/payments.service';

type ConversationOutcome = Database['public']['Enums']['conversation_outcome'];

export interface AdminActorContext {
  readonly actorUserId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

@Injectable()
export class AdminWriteService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly stripe: StripeService,
    private readonly twilio: TwilioService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditLogService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(AdminWriteService.name);
  }

  // ── lead actions ─────────────────────────────────────────────────────────

  /**
   * Sales-team action: flip a user's email_confirmed_at when they've verified
   * out-of-band (e.g. confirmed verbally on a sales call, signed paperwork).
   * Doesn't send the user a confirmation email — just marks the auth.users
   * row as confirmed so they can sign in. Audit-logged with reason.
   */
  async markEmailVerified(args: {
    userId: string;
    actor: AdminActorContext;
    reason: string;
  }): Promise<{ user_id: string; email: string | null }> {
    const { data: userResp, error: lookupErr } = await this.supabase
      .db()
      .auth.admin.getUserById(args.userId);
    if (lookupErr || !userResp?.user) {
      throw new NotFoundError(`No auth user with id ${args.userId}`);
    }
    if (userResp.user.email_confirmed_at) {
      // Already confirmed — idempotent no-op, still audit so we know sales tried.
      await this.audit.write({
        actorUserId: args.actor.actorUserId,
        operatorId: null,
        action: 'lead.email_already_verified',
        resourceType: 'auth_user',
        resourceId: args.userId,
        metadata: { reason: args.reason, email: userResp.user.email ?? null },
        ipAddress: args.actor.ipAddress,
        userAgent: args.actor.userAgent,
      });
      return { user_id: args.userId, email: userResp.user.email ?? null };
    }

    const { error: updErr } = await this.supabase
      .db()
      .auth.admin.updateUserById(args.userId, { email_confirm: true });
    if (updErr) {
      this.logger.error({ userId: args.userId, err: updErr.message }, 'markEmailVerified failed');
      throw new AppError({ code: 'admin.email_verify_failed', status: 502, detail: updErr.message });
    }

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: null,
      action: 'lead.email_verified',
      resourceType: 'auth_user',
      resourceId: args.userId,
      metadata: { reason: args.reason, email: userResp.user.email ?? null },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
    return { user_id: args.userId, email: userResp.user.email ?? null };
  }

  // ── admin promotion ──────────────────────────────────────────────────────

  async promoteAdmin(args: { email: string; actor: AdminActorContext }): Promise<{
    user_id: string;
  }> {
    // Find user first so we can write a clean audit entry and a useful 404.
    const { data: userResp, error: lookupErr } = await this.supabase
      .db()
      .auth.admin.listUsers({ page: 1, perPage: 200 });
    if (lookupErr) throw lookupErr;
    const target = userResp.users.find((u) => u.email === args.email);
    if (!target) throw new NotFoundError(`No user with email ${args.email}`);

    const next = {
      ...(target.app_metadata ?? {}),
      role: 'admin',
    };
    const { error: updErr } = await this.supabase
      .db()
      .auth.admin.updateUserById(target.id, { app_metadata: next });
    if (updErr) throw updErr;

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: null,
      action: 'admin.promote',
      resourceType: 'auth.user',
      resourceId: target.id,
      metadata: { email: args.email },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });

    return { user_id: target.id };
  }

  async demoteAdmin(args: { userId: string; actor: AdminActorContext }): Promise<void> {
    if (args.userId === args.actor.actorUserId) {
      throw new ValidationError('Admins cannot demote themselves');
    }
    const { data: userResp, error: lookupErr } = await this.supabase
      .db()
      .auth.admin.getUserById(args.userId);
    if (lookupErr) throw lookupErr;
    if (!userResp.user) throw new NotFoundError('User not found');

    const existing = (userResp.user.app_metadata ?? {}) as Record<string, unknown>;
    // Strip role; preserve anything else.
    const next: Record<string, unknown> = { ...existing };
    delete next.role;

    const { error } = await this.supabase
      .db()
      .auth.admin.updateUserById(args.userId, { app_metadata: next });
    if (error) throw error;

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: null,
      action: 'admin.demote',
      resourceType: 'auth.user',
      resourceId: args.userId,
      metadata: {},
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  /**
   * Promote a user to role='sales' AND link their Slack identity (#4). The link
   * lets their existing #bb-leads claims resolve to this BB account so they can
   * "login as" the operators behind leads they claimed. Idempotent.
   */
  async promoteSales(args: {
    email: string;
    slackUserId: string;
    slackUsername?: string;
    actor: AdminActorContext;
  }): Promise<{ user_id: string }> {
    const { data: userResp, error: lookupErr } = await this.supabase
      .db()
      .auth.admin.listUsers({ page: 1, perPage: 200 });
    if (lookupErr) throw lookupErr;
    const target = userResp.users.find((u) => u.email === args.email);
    if (!target) throw new NotFoundError(`No user with email ${args.email}`);

    const next = { ...(target.app_metadata ?? {}), role: 'sales' };
    const { error: updErr } = await this.supabase
      .db()
      .auth.admin.updateUserById(target.id, { app_metadata: next });
    if (updErr) throw updErr;

    const { error: linkErr } = await this.supabase
      .db()
      .from('sales_slack_links')
      .upsert(
        {
          user_id: target.id,
          slack_user_id: args.slackUserId,
          slack_username: args.slackUsername ?? null,
        },
        { onConflict: 'user_id' },
      );
    if (linkErr) throw linkErr;

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: null,
      action: 'sales.promote',
      resourceType: 'auth.user',
      resourceId: target.id,
      metadata: { email: args.email, slack_user_id: args.slackUserId },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });

    return { user_id: target.id };
  }

  /** Demote a sales rep: strip role and remove their Slack link (#4). */
  async demoteSales(args: { userId: string; actor: AdminActorContext }): Promise<void> {
    const { data: userResp, error: lookupErr } = await this.supabase
      .db()
      .auth.admin.getUserById(args.userId);
    if (lookupErr) throw lookupErr;
    if (!userResp.user) throw new NotFoundError('User not found');

    const existing = (userResp.user.app_metadata ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...existing };
    delete next.role;
    const { error: updErr } = await this.supabase
      .db()
      .auth.admin.updateUserById(args.userId, { app_metadata: next });
    if (updErr) throw updErr;

    const { error: delErr } = await this.supabase
      .db()
      .from('sales_slack_links')
      .delete()
      .eq('user_id', args.userId);
    if (delErr) throw delErr;

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: null,
      action: 'sales.demote',
      resourceType: 'auth.user',
      resourceId: args.userId,
      metadata: {},
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  // ── operator lifecycle ───────────────────────────────────────────────────

  async deactivateOperator(args: {
    operatorId: string;
    reason: string;
    immediate: boolean;
    actor: AdminActorContext;
  }): Promise<void> {
    const operator = await this.requireOperator(args.operatorId);

    // 1. Cancel Stripe subscription (immediately or at period end).
    if (operator.stripe_subscription_id) {
      try {
        if (args.immediate) {
          await this.stripe.client().subscriptions.cancel(operator.stripe_subscription_id, {
            invoice_now: false,
            prorate: false,
          });
        } else {
          await this.stripe
            .client()
            .subscriptions.update(operator.stripe_subscription_id, {
              cancel_at_period_end: true,
            });
        }
      } catch (err) {
        this.logger.warn(
          { operatorId: operator.id, err: (err as Error).message },
          'stripe cancel during deactivate failed; continuing',
        );
      }
    }

    // 2. Mark conversations escalated/closed so the bot won't reply on them.
    await this.supabase
      .db()
      .from('conversations')
      .update({ status: 'completed', completed_at: new Date().toISOString(), outcome: 'rejected' })
      .eq('operator_id', operator.id)
      .in('status', ['awaiting_caller', 'awaiting_bot', 'active', 'escalated']);

    // 3. Note: Twilio number release happens via a separate endpoint to keep
    // the audit trail clear and so the admin can decide grace period.

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: operator.id,
      action: 'operator.deactivate',
      resourceType: 'operator',
      resourceId: operator.id,
      metadata: {
        reason: args.reason,
        immediate: args.immediate,
        prior_subscription_status: operator.subscription_status,
      },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  async cancelSubscription(args: {
    operatorId: string;
    reason: string;
    immediate: boolean;
    actor: AdminActorContext;
  }): Promise<void> {
    const operator = await this.requireOperator(args.operatorId);
    if (!operator.stripe_subscription_id) {
      throw new ValidationError('Operator has no active subscription');
    }
    let updated: Stripe.Subscription;
    if (args.immediate) {
      updated = await this.stripe
        .client()
        .subscriptions.cancel(operator.stripe_subscription_id, {
          invoice_now: false,
          prorate: false,
        });
    } else {
      updated = await this.stripe
        .client()
        .subscriptions.update(operator.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
    }
    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: operator.id,
      action: 'subscription.cancel',
      resourceType: 'stripe.subscription',
      resourceId: operator.stripe_subscription_id,
      metadata: {
        reason: args.reason,
        immediate: args.immediate,
        stripe_status: updated.status,
      },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  async releaseTwilioNumber(args: {
    operatorId: string;
    actor: AdminActorContext;
  }): Promise<void> {
    const operator = await this.requireOperator(args.operatorId);
    if (!operator.twilio_number_sid) {
      throw new ValidationError('Operator has no Twilio number assigned');
    }
    const sid = operator.twilio_number_sid;

    try {
      await this.twilio.client().incomingPhoneNumbers(sid).remove();
    } catch (err) {
      // If Twilio says "not found", treat as already released and continue
      // with local cleanup. Anything else is a real failure.
      const message = (err as Error).message ?? '';
      if (!message.includes('not found') && !message.includes('20404')) {
        throw err;
      }
      this.logger.warn({ sid }, 'Twilio number already gone; cleaning up DB');
    }

    await this.supabase
      .db()
      .from('twilio_numbers')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('twilio_sid', sid);

    await this.supabase
      .db()
      .from('operators')
      .update({ twilio_number_e164: null, twilio_number_sid: null })
      .eq('id', operator.id);

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: operator.id,
      action: 'twilio_number.release',
      resourceType: 'twilio.phone_number',
      resourceId: sid,
      metadata: { prior_e164: operator.twilio_number_e164 },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  // ── payments ─────────────────────────────────────────────────────────────

  async refundPayment(args: {
    operatorId: string;
    paymentId: string;
    reason: string;
    actor: AdminActorContext;
  }): Promise<void> {
    const { data: payment, error } = await this.supabase
      .db()
      .from('payments')
      .select('*')
      .eq('id', args.paymentId)
      .maybeSingle();
    if (error) throw error;
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.operator_id !== args.operatorId) {
      throw new ConflictError('Payment does not belong to this operator');
    }

    await this.payments.refundBookingFee(args.paymentId, args.reason);

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: args.operatorId,
      action: 'payment.refund',
      resourceType: 'payment',
      resourceId: args.paymentId,
      metadata: {
        reason: args.reason,
        amount_cents: payment.amount_cents,
        connected_account: payment.stripe_connected_account_id,
        payment_intent: payment.stripe_payment_intent_id,
      },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  // ── conversations ────────────────────────────────────────────────────────

  async forceEndConversation(args: {
    conversationId: string;
    outcome: ConversationOutcome;
    reason: string;
    actor: AdminActorContext;
  }): Promise<void> {
    const { data: convo, error } = await this.supabase
      .db()
      .from('conversations')
      .select('id, operator_id, status')
      .eq('id', args.conversationId)
      .maybeSingle();
    if (error) throw error;
    if (!convo) throw new NotFoundError('Conversation not found');

    const { error: updErr } = await this.supabase
      .db()
      .from('conversations')
      .update({
        status: 'completed',
        outcome: args.outcome,
        completed_at: new Date().toISOString(),
      })
      .eq('id', convo.id);
    if (updErr) throw updErr;

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: convo.operator_id,
      action: 'conversation.force_end',
      resourceType: 'conversation',
      resourceId: convo.id,
      metadata: { reason: args.reason, outcome: args.outcome, prior_status: convo.status },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  // ── impersonation ────────────────────────────────────────────────────────

  /**
   * Mint a short-lived magic link for the target operator's user. The admin
   * follows the link in a private tab, which logs them in as that user.
   *
   * Strong audit trail: every impersonation is logged and (when Slack is wired
   * in Slice 7.5) posts a notification to the admin channel.
   *
   * Note: this returns a magic-link URL, not a token. Supabase's standard
   * magic-link flow gives us session continuity without us needing to mint
   * raw JWTs. TTL is bounded by Supabase's link expiry.
   */
  async impersonateOperator(args: {
    operatorId: string;
    actor: AdminActorContext;
    reason: string;
  }): Promise<{ action_link: string }> {
    const operator = await this.requireOperator(args.operatorId);
    const { data: userResp, error: userErr } = await this.supabase
      .db()
      .auth.admin.getUserById(operator.user_id);
    if (userErr) throw userErr;
    const email = userResp?.user?.email;
    if (!email) {
      throw new ConflictError('Operator user has no email; cannot generate impersonation link');
    }

    const { data, error } = await this.supabase
      .db()
      .auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: `${this.env.APP_URL}/dashboard?impersonating=1`,
        },
      });
    if (error || !data?.properties?.hashed_token) {
      throw new AppError({
        code: 'admin.impersonate_failed',
        status: 502,
        detail: 'Supabase did not return an action link',
      });
    }

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: operator.id,
      action: 'operator.impersonate',
      resourceType: 'operator',
      resourceId: operator.id,
      metadata: { reason: args.reason, target_user_id: operator.user_id },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });

    return { action_link: impersonationConfirmLink(this.env.APP_URL, data.properties.hashed_token) };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async requireOperator(
    operatorId: string,
  ): Promise<NonNullable<Awaited<ReturnType<typeof this.fetchOperator>>>> {
    const op = await this.fetchOperator(operatorId);
    if (!op) throw new NotFoundError('Operator not found');
    return op;
  }

  private async fetchOperator(operatorId: string) {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
}
