import { Inject, Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import type { Tables } from '@bookingblues/db-types';

import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import type {
  Cadence,
  CheckoutSessionResponse,
  Plan,
  PortalSessionResponse,
} from './billing.dto';

type OperatorRow = Tables<'operators'>;

/**
 * Subscription states that represent a still-live Stripe subscription. Starting
 * a new Checkout while in one of these would create a SECOND subscription on the
 * same customer and double-bill (Slice 4-followup). Re-subscribing is only
 * allowed from a terminal state (`canceled` / `incomplete_expired`) or when no
 * subscription exists yet.
 */
const LIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  'trialing',
  'active',
  'past_due',
  'incomplete',
]);

@Injectable()
export class BillingService {
  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  async createCheckoutSession(
    userId: string,
    userEmail: string | null,
    plan: Plan,
    cadence: Cadence,
    businessName?: string,
  ): Promise<CheckoutSessionResponse> {
    const priceId = this.priceForPlan(plan, cadence);

    const operator = await this.ensureOperator(userId, userEmail, businessName);

    // Duplicate-subscription guard (Slice 4-followup). If the operator already
    // has a live subscription, a second Checkout creates a second Stripe
    // subscription on the same customer → double-bill on the next cycle. Send
    // them to the billing portal to manage the existing one instead.
    if (
      operator.stripe_subscription_id &&
      operator.subscription_status &&
      LIVE_SUBSCRIPTION_STATUSES.has(operator.subscription_status)
    ) {
      throw new ConflictError(
        `This account already has a ${operator.subscription_status} subscription. ` +
          'Manage it from the billing portal instead of starting a new one.',
      );
    }

    const customerId = await this.ensureStripeCustomer(operator, userEmail);

    // Stripe webhooks see this metadata on the subscription object —
    // stripe-event-handlers.ts pulls plan + cadence out of here to keep
    // operators.plan / .plan_cadence / .stripe_price_id in sync. Without
    // them on subscription_data.metadata we'd have to re-fetch on every
    // event.
    const metadata = { operator_id: operator.id, plan, cadence, stripe_price_id: priceId };

    const session = await this.stripe.client().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: operator.id,
      payment_method_collection: 'always',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: this.env.TRIAL_DAYS,
        trial_settings: {
          end_behavior: { missing_payment_method: 'cancel' },
        },
        metadata,
      },
      success_url: `${this.env.APP_URL}/dashboard?subscription=success`,
      cancel_url: `${this.env.APP_URL}/pricing?subscription=cancelled`,
      metadata,
    });

    if (!session.url) {
      throw new AppError({
        code: 'stripe.no_checkout_url',
        status: 502,
        detail: 'Stripe did not return a Checkout URL',
      });
    }
    return { url: session.url };
  }

  async createPortalSession(userId: string): Promise<PortalSessionResponse> {
    const operator = await this.getOperatorByUserId(userId);
    if (!operator) throw new NotFoundError('Operator not found');
    if (!operator.stripe_customer_id) {
      throw new ConflictError('Operator has no Stripe customer yet — start a subscription first');
    }
    const session = await this.stripe.client().billingPortal.sessions.create({
      customer: operator.stripe_customer_id,
      // Stripe portal redirects here when the user clicks Return. The simple
      // /settings page is the natural landing — it already shows subscription
      // status and the "Open billing portal" button, so the customer ends
      // up exactly where they would've expected.
      return_url: `${this.env.APP_URL}/settings`,
    });
    return { url: session.url };
  }

  /**
   * End the trial immediately. Stripe attempts to charge the saved card via
   * `customer.subscription.updated` → `invoice.payment_succeeded` (status flips
   * to `active`) or `invoice.payment_failed` (status flips to `past_due`).
   * Webhook handlers already cover both transitions; this just kicks them off.
   */
  async endTrialNow(userId: string): Promise<void> {
    const operator = await this.getOperatorByUserId(userId);
    if (!operator) throw new NotFoundError('Operator not found');
    if (!operator.stripe_subscription_id) {
      throw new ConflictError('Operator has no active subscription');
    }
    if (operator.subscription_status !== 'trialing') {
      throw new ValidationError(
        `Subscription is ${operator.subscription_status ?? 'not set'} — only trialing subscriptions can be ended early`,
      );
    }
    await this.stripe.client().subscriptions.update(operator.stripe_subscription_id, {
      trial_end: 'now',
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private priceForPlan(plan: Plan, cadence: Cadence): string {
    const key = `STRIPE_PRICE_${plan.toUpperCase()}_${cadence.toUpperCase()}` as
      | 'STRIPE_PRICE_SOLO_MONTHLY'
      | 'STRIPE_PRICE_SOLO_ANNUAL'
      | 'STRIPE_PRICE_CREW_MONTHLY'
      | 'STRIPE_PRICE_CREW_ANNUAL'
      | 'STRIPE_PRICE_FLEET_MONTHLY'
      | 'STRIPE_PRICE_FLEET_ANNUAL';
    const id = this.env[key];
    if (!id) throw new ValidationError(`${key} is not configured`);
    return id;
  }

  private async getOperatorByUserId(userId: string): Promise<OperatorRow | null> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  private async ensureOperator(
    userId: string,
    userEmail: string | null,
    businessName?: string,
  ): Promise<OperatorRow> {
    const existing = await this.getOperatorByUserId(userId);
    if (existing) return existing;
    const fallbackName =
      businessName?.trim() ||
      (userEmail ? userEmail.split('@')[0] : null) ||
      'New Business';
    // Copy the consent record stashed at signup so the operators mirror is
    // populated even when this billing path (not the operators bootstrap) is
    // what first creates the row.
    const terms = await this.termsFromAuthMetadata(userId);
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .insert({ user_id: userId, business_name: fallbackName, ...terms })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  private async termsFromAuthMetadata(
    userId: string,
  ): Promise<{ terms_accepted_at?: string; terms_version?: string }> {
    try {
      const { data, error } = await this.supabase.db().auth.admin.getUserById(userId);
      if (error || !data?.user) return {};
      const m = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      const out: { terms_accepted_at?: string; terms_version?: string } = {};
      if (typeof m.terms_accepted_at === 'string') out.terms_accepted_at = m.terms_accepted_at;
      if (typeof m.terms_version === 'string') out.terms_version = m.terms_version;
      return out;
    } catch {
      return {};
    }
  }

  private async ensureStripeCustomer(
    operator: OperatorRow,
    userEmail: string | null,
  ): Promise<string> {
    if (operator.stripe_customer_id) return operator.stripe_customer_id;

    const customer: Stripe.Customer = await this.stripe.client().customers.create({
      ...(userEmail ? { email: userEmail } : {}),
      name: operator.business_name,
      metadata: { operator_id: operator.id, user_id: operator.user_id },
    });

    const { error } = await this.supabase
      .db()
      .from('operators')
      .update({ stripe_customer_id: customer.id })
      .eq('id', operator.id);
    if (error) {
      // Best-effort: the Stripe customer is already created; surface the DB error
      // so the caller can retry. The metadata on the Stripe customer lets us
      // reconcile via `customer_id ↔ operator_id` if this happens.
      throw error;
    }
    return customer.id;
  }
}
