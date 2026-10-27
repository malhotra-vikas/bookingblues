import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Database } from '@bookingblues/db-types';
import type Stripe from 'stripe';

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
import { buildLeadBlocks } from '../leads/leads.controller';
import { SlackApiClient } from '../slack/slack-api.client';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { PaymentsService } from '../payments/payments.service';
import { priceIdForPlan, type PlanCadence, type PlanSlug } from '../billing/plan-pricing';
import { specialCouponTerms, specialPricingOf } from '../billing/special-pricing';

type ConversationOutcome = Database['public']['Enums']['conversation_outcome'];

/** Subscription states with a Stripe subscription still billing (or about to). */
const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  'trialing',
  'active',
  'past_due',
  'incomplete',
]);

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
    private readonly slack: SlackApiClient,
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

  /**
   * Demote a sales rep (#4): strip the sales role and remove their email↔Slack
   * link. Does NOT touch their claimed leads — claims are keyed on the Slack
   * identity, so they persist (and would resolve again if the same Slack ID is
   * re-linked to a BB account). Release leads separately via {@link releaseSalesLeads}.
   */
  async demoteSales(args: { userId: string; actor: AdminActorContext }): Promise<void> {
    const { data: userResp, error: lookupErr } = await this.supabase
      .db()
      .auth.admin.getUserById(args.userId);
    if (lookupErr) throw lookupErr;
    if (!userResp.user) throw new NotFoundError('User not found');

    const { data: link } = await this.supabase
      .db()
      .from('sales_slack_links')
      .select('slack_user_id')
      .eq('user_id', args.userId)
      .maybeSingle();

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
      metadata: { slack_user_id: link?.slack_user_id ?? null },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  /**
   * Selectively release leads claimed by a sales rep (#4) back to the #bb-leads
   * pool — one, several, or all. Deletes the matching `lead_claims` rows (so the
   * leads show unclaimed in /admin/leads) and re-posts each to #bb-leads as
   * available to claim. Independent of the sales role: the rep stays promoted.
   * Only leads actually claimed by this rep's Slack ID are released. Returns the
   * number released.
   */
  async releaseSalesLeads(args: {
    userId: string;
    leadUserIds: ReadonlyArray<string>;
    actor: AdminActorContext;
  }): Promise<{ released_leads: number }> {
    const { data: link, error: linkErr } = await this.supabase
      .db()
      .from('sales_slack_links')
      .select('slack_user_id')
      .eq('user_id', args.userId)
      .maybeSingle();
    if (linkErr) throw linkErr;
    if (!link?.slack_user_id) {
      throw new NotFoundError('That user is not a linked sales rep');
    }
    const slackUserId = link.slack_user_id;

    // Scope to claims actually owned by this rep's Slack ID, so a stray id in
    // the request can't release someone else's lead.
    const { data: claims, error } = await this.supabase
      .db()
      .from('lead_claims')
      .select('user_id')
      .eq('claimed_by_slack_user_id', slackUserId)
      .in('user_id', [...args.leadUserIds]);
    if (error) throw error;
    const userIds = (claims ?? []).map((c) => c.user_id);
    if (userIds.length === 0) return { released_leads: 0 };

    const { error: delErr } = await this.supabase
      .db()
      .from('lead_claims')
      .delete()
      .eq('claimed_by_slack_user_id', slackUserId)
      .in('user_id', userIds);
    if (delErr) throw delErr;

    await this.repostLeadsAsAvailable(userIds);

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: null,
      action: 'sales.release_leads',
      resourceType: 'auth.user',
      resourceId: args.userId,
      metadata: { slack_user_id: slackUserId, released_lead_user_ids: userIds },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });

    return { released_leads: userIds.length };
  }

  /**
   * Re-post released leads to #bb-leads as available to claim, reusing the same
   * Claim button so the team can re-file them. Best-effort: a Slack failure for
   * one lead is logged and skipped, never thrown.
   */
  private async repostLeadsAsAvailable(userIds: ReadonlyArray<string>): Promise<void> {
    const channel = this.slack.leadsChannelId();
    if (!this.slack.isConfigured() || !channel || userIds.length === 0) return;

    const { data: ops } = await this.supabase
      .db()
      .from('operators')
      .select('user_id, business_name, personal_phone_e164')
      .in('user_id', [...userIds]);
    const opByUser = new Map((ops ?? []).map((o) => [o.user_id, o]));
    const adminUrl = `${this.env.APP_URL.replace(/\/$/, '')}/admin/leads`;

    for (const userId of userIds) {
      try {
        const { data: u } = await this.supabase.db().auth.admin.getUserById(userId);
        const op = opByUser.get(userId);
        const meta = (u?.user?.user_metadata ?? {}) as {
          business_name?: string;
          personal_phone_e164?: string;
        };
        const email = u?.user?.email ?? '(no email)';
        const businessName = op?.business_name ?? meta.business_name ?? '(unnamed)';
        const phoneE164 = op?.personal_phone_e164 ?? meta.personal_phone_e164 ?? '+10000000000';
        await this.slack.postMessage({
          channel,
          text: `Lead available to claim: ${businessName} · ${email}`,
          blocks: buildLeadBlocks({
            userId,
            email,
            businessName,
            phoneE164,
            adminUrl,
            headline: `:arrows_counterclockwise: *Lead available to claim* — *${businessName}*`,
          }),
        });
      } catch (err) {
        this.logger.warn(
          { userId, err: (err as Error).message },
          'repostLeadsAsAvailable: Slack re-post failed for lead',
        );
      }
    }
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

    // 2. Authoritatively mark the operator canceled in our DB. Deactivate is an
    // admin kill switch — it must take effect immediately and NOT depend on the
    // Stripe `customer.subscription.deleted` webhook (which never fires if the
    // operator has no live subscription, e.g. a stale/deleted sub id).
    const { error: statusErr } = await this.supabase
      .db()
      .from('operators')
      .update({ subscription_status: 'canceled' })
      .eq('id', operator.id);
    if (statusErr) throw statusErr;

    // 3. Mark conversations escalated/closed so the bot won't reply on them.
    await this.supabase
      .db()
      .from('conversations')
      .update({ status: 'completed', completed_at: new Date().toISOString(), outcome: 'rejected' })
      .eq('operator_id', operator.id)
      .in('status', ['awaiting_caller', 'awaiting_bot', 'active', 'escalated']);

    // 4. Note: Twilio number release happens via a separate endpoint to keep
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

    // Stripe is the billing source of truth, but we reconcile our DB directly so
    // the change is visible immediately (and so a stale/deleted sub id doesn't
    // leave the operator looking active forever, with no webhook to fix it).
    let stripeStatus = 'canceled';
    try {
      const updated = args.immediate
        ? await this.stripe.client().subscriptions.cancel(operator.stripe_subscription_id, {
            invoice_now: false,
            prorate: false,
          })
        : await this.stripe.client().subscriptions.update(operator.stripe_subscription_id, {
            cancel_at_period_end: true,
          });
      stripeStatus = updated.status;
    } catch (err) {
      // A deleted/unknown subscription means there is nothing left to cancel —
      // reconcile to canceled rather than failing the admin action.
      if ((err as { code?: string }).code === 'resource_missing') {
        this.logger.warn(
          { operatorId: operator.id, sub: operator.stripe_subscription_id },
          'cancelSubscription: Stripe subscription missing; reconciling DB to canceled',
        );
        stripeStatus = 'canceled';
      } else {
        throw err;
      }
    }

    // Immediate cancel (or a sub already gone on Stripe) takes effect now; a
    // period-end cancel keeps the operator active until Stripe's webhook flips it.
    if (args.immediate || stripeStatus === 'canceled') {
      const { error: statusErr } = await this.supabase
        .db()
        .from('operators')
        .update({ subscription_status: 'canceled' })
        .eq('id', operator.id);
      if (statusErr) throw statusErr;
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
        stripe_status: stripeStatus,
      },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });
  }

  /**
   * Give one operator a special price: `priceCents` per month/year for
   * `periods` months/years on `plan`, then the regular price. Backed by a
   * per-operator Stripe coupon that checkout uses instead of the Founding
   * promo. If the operator already has a live subscription on that same plan +
   * cadence, the coupon goes onto it immediately; a different plan is refused,
   * because the coupon is restricted to the plan's product and would never apply.
   */
  async setSpecialPricing(args: {
    operatorId: string;
    plan: PlanSlug;
    cadence: PlanCadence;
    priceCents: number;
    periods: number;
    reason: string;
    actor: AdminActorContext;
  }): Promise<{ coupon_id: string; applied_to_subscription: boolean }> {
    const operator = await this.requireOperator(args.operatorId);

    const subscriptionId =
      operator.stripe_subscription_id &&
      operator.subscription_status &&
      LIVE_SUBSCRIPTION_STATUSES.has(operator.subscription_status)
        ? operator.stripe_subscription_id
        : null;
    if (subscriptionId && (operator.plan !== args.plan || operator.plan_cadence !== args.cadence)) {
      throw new ValidationError(
        `Operator is subscribed to ${operator.plan ?? 'an unknown plan'} ` +
          `(${operator.plan_cadence ?? 'unknown cadence'}). Special pricing must match ` +
          'their current plan and cadence — have them switch plans first.',
      );
    }

    const priceId = priceIdForPlan(this.env, args.plan, args.cadence);
    if (!priceId) throw new ValidationError(`No Stripe price configured for ${args.plan} ${args.cadence}`);
    const price = await this.stripe.client().prices.retrieve(priceId);
    if (price.unit_amount == null) {
      throw new AppError({
        code: 'stripe.price_without_amount',
        status: 502,
        detail: `Stripe price ${priceId} has no fixed amount`,
      });
    }
    const terms = specialCouponTerms({
      regularCents: price.unit_amount,
      priceCents: args.priceCents,
      cadence: args.cadence,
      periods: args.periods,
    });

    const unit = args.cadence === 'annual' ? 'yr' : 'mo';
    const span = args.cadence === 'annual' ? 'year' : 'month';
    const coupon = await this.stripe.client().coupons.create({
      name: `Special: $${(args.priceCents / 100).toFixed(2)}/${unit} × ${args.periods} ${span}${args.periods === 1 ? '' : 's'}`.slice(0, 40),
      amount_off: terms.amountOffCents,
      currency: price.currency,
      duration: 'repeating',
      duration_in_months: terms.durationInMonths,
      max_redemptions: 1,
      applies_to: { products: [typeof price.product === 'string' ? price.product : price.product.id] },
      metadata: {
        kind: 'special_pricing',
        operator_id: operator.id,
        plan: args.plan,
        cadence: args.cadence,
        price_cents: String(args.priceCents),
        periods: String(args.periods),
      },
    });

    if (subscriptionId) {
      try {
        // Replaces any discount already on it (e.g. a pending Founding coupon).
        await this.stripe.client().subscriptions.update(subscriptionId, {
          discounts: [{ coupon: coupon.id }],
        });
      } catch (err) {
        await this.deleteCouponQuietly(coupon.id);
        throw err;
      }
    }

    const { error } = await this.supabase
      .db()
      .from('operators')
      .update({
        special_price_plan: args.plan,
        special_price_cadence: args.cadence,
        special_price_cents: args.priceCents,
        special_price_periods: args.periods,
        special_price_coupon_id: coupon.id,
        special_price_set_at: new Date().toISOString(),
      })
      .eq('id', operator.id);
    if (error) throw error;

    // Discounts already granted keep working after their coupon is deleted, so
    // retiring the replaced coupon only stops it being redeemed again.
    const previous = specialPricingOf(operator);
    if (previous && previous.couponId !== coupon.id) await this.deleteCouponQuietly(previous.couponId);

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: operator.id,
      action: 'billing.special_pricing.set',
      resourceType: 'stripe.coupon',
      resourceId: coupon.id,
      metadata: {
        reason: args.reason,
        plan: args.plan,
        cadence: args.cadence,
        price_cents: args.priceCents,
        periods: args.periods,
        regular_cents: price.unit_amount,
        applied_to_subscription: subscriptionId,
        replaced_coupon_id: previous?.couponId ?? null,
      },
      ipAddress: args.actor.ipAddress,
      userAgent: args.actor.userAgent,
    });

    return { coupon_id: coupon.id, applied_to_subscription: subscriptionId != null };
  }

  /** Remove an operator's special pricing, including from a live subscription. */
  async clearSpecialPricing(args: {
    operatorId: string;
    reason: string;
    actor: AdminActorContext;
  }): Promise<void> {
    const operator = await this.requireOperator(args.operatorId);
    const special = specialPricingOf(operator);
    if (!special) throw new ConflictError('Operator has no special pricing');

    let removedFromSubscription = false;
    if (operator.stripe_subscription_id) {
      try {
        const sub = await this.stripe
          .client()
          .subscriptions.retrieve(operator.stripe_subscription_id, { expand: ['discounts'] });
        const discounts = sub.discounts.filter(
          (d): d is Stripe.Discount => typeof d !== 'string',
        );
        const kept = discounts.filter((d) => d.coupon.id !== special.couponId);
        if (kept.length !== discounts.length) {
          await this.stripe.client().subscriptions.update(operator.stripe_subscription_id, {
            discounts: kept.length ? kept.map((d) => ({ discount: d.id })) : '',
          });
          removedFromSubscription = true;
        }
      } catch (err) {
        // A subscription that no longer exists has no discount left to remove.
        if ((err as { code?: string }).code !== 'resource_missing') throw err;
      }
    }

    const { error } = await this.supabase
      .db()
      .from('operators')
      .update({
        special_price_plan: null,
        special_price_cadence: null,
        special_price_cents: null,
        special_price_periods: null,
        special_price_coupon_id: null,
        special_price_set_at: null,
      })
      .eq('id', operator.id);
    if (error) throw error;

    await this.deleteCouponQuietly(special.couponId);

    await this.audit.write({
      actorUserId: args.actor.actorUserId,
      operatorId: operator.id,
      action: 'billing.special_pricing.clear',
      resourceType: 'stripe.coupon',
      resourceId: special.couponId,
      metadata: {
        reason: args.reason,
        plan: special.plan,
        cadence: special.cadence,
        price_cents: special.priceCents,
        periods: special.periods,
        removed_from_subscription: removedFromSubscription,
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

  /** Retire a coupon in Stripe. Best-effort: a leftover coupon is harmless. */
  private async deleteCouponQuietly(couponId: string): Promise<void> {
    try {
      await this.stripe.client().coupons.del(couponId);
    } catch (err) {
      this.logger.warn({ couponId, err }, 'special pricing: could not delete Stripe coupon');
    }
  }

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
