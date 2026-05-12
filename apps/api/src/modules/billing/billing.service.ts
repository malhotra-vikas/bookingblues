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
import type { CheckoutSessionResponse, Plan, PortalSessionResponse } from './billing.dto';

type OperatorRow = Tables<'operators'>;

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
    businessName?: string,
  ): Promise<CheckoutSessionResponse> {
    const priceId = this.priceForPlan(plan);

    const operator = await this.ensureOperator(userId, userEmail, businessName);
    const customerId = await this.ensureStripeCustomer(operator, userEmail);

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
        metadata: { operator_id: operator.id, plan },
      },
      success_url: `${this.env.APP_URL}/dashboard?subscription=success`,
      cancel_url: `${this.env.APP_URL}/pricing?subscription=cancelled`,
      metadata: { operator_id: operator.id, plan },
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

  private priceForPlan(plan: Plan): string {
    if (plan === 'starter') {
      const id = this.env.STRIPE_PRICE_STARTER;
      if (!id) throw new ValidationError('STRIPE_PRICE_STARTER is not configured');
      return id;
    }
    const id = this.env.STRIPE_PRICE_PRO;
    if (!id) throw new ValidationError('STRIPE_PRICE_PRO is not configured');
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
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .insert({ user_id: userId, business_name: fallbackName })
      .select('*')
      .single();
    if (error) throw error;
    return data;
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
