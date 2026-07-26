import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import {
  ConflictError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../common/errors/app-error';
import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { platformTakeRateBpsForPlan } from '../billing/plan-policy';
import { compactUuid } from '../../common/util/uuid';
import { computeBookingFeeCharge } from './pricing';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(PaymentsService.name);
  }

  /**
   * CLAUDE.md §9.5 four-gate eligibility check. Throws a clear error rather
   * than silently downgrading; callers (the AI's `request_payment_link` tool)
   * decide whether to proceed without a fee.
   */
  async ensureFeeEligible(operatorId: string): Promise<{
    operatorId: string;
    feeCents: number;
    emergencyFeeCents: number;
    plan: string | null;
    connectAccountId: string;
  }> {
    const { data: op, error } = await this.supabase
      .db()
      .from('operators')
      .select(
        'id, plan, booking_fee_enabled, booking_fee_cents, emergency_visit_fee_cents, subscription_status, stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled',
      )
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!op) throw new NotFoundError('Operator not found');

    if (!op.booking_fee_enabled || op.booking_fee_cents == null) {
      throw new ValidationError('booking fee not enabled');
    }
    if (op.subscription_status !== 'trialing' && op.subscription_status !== 'active') {
      throw new ValidationError(`subscription status (${op.subscription_status}) not in trial/active`);
    }
    if (!op.stripe_connect_account_id) {
      throw new ValidationError('Stripe Connect account not yet created');
    }
    if (!op.stripe_connect_charges_enabled || !op.stripe_connect_payouts_enabled) {
      throw new ValidationError('Stripe Connect onboarding not complete');
    }
    return {
      operatorId: op.id,
      feeCents: op.booking_fee_cents,
      emergencyFeeCents: op.emergency_visit_fee_cents ?? 0,
      plan: op.plan,
      connectAccountId: op.stripe_connect_account_id,
    };
  }

  /**
   * Create a Direct-Charges Checkout Session on the connected account.
   * Returns the URL to send to the caller. Persists a `payments` row in
   * `pending` so the Connect webhook can flip it to `succeeded` later.
   */
  async createBookingFeeCheckout(args: {
    operatorId: string;
    appointmentId: string;
    /** Emergency booking — adds the operator's emergency visit fee to the charge. */
    emergency?: boolean;
  }): Promise<{ url: string; paymentId: string }> {
    const eligibility = await this.ensureFeeEligible(args.operatorId);
    // Take rate is per-plan (Solo 15% / Crew 12% / Fleet 10% by default), charged on
    // top of the deposit and paid by the caller. Rates are env-configurable via
    // PLATFORM_TAKE_RATE_BPS_{SOLO,CREW,FLEET}. Legacy/null plans fall back to the
    // global env default so a missing plan never blocks fee collection.
    const takeRateBps =
      platformTakeRateBpsForPlan(eligibility.plan, {
        solo: this.env.PLATFORM_TAKE_RATE_BPS_SOLO,
        crew: this.env.PLATFORM_TAKE_RATE_BPS_CREW,
        fleet: this.env.PLATFORM_TAKE_RATE_BPS_FLEET,
      }) ?? this.env.PLATFORM_TAKE_RATE_BPS;
    const pricing = computeBookingFeeCharge({
      depositCents: eligibility.feeCents,
      ...(args.emergency ? { emergencyFeeCents: eligibility.emergencyFeeCents } : {}),
      takeRateBps,
      minPlatformFeeCents: this.env.MIN_PLATFORM_FEE_CENTS,
    });

    const session = await this.stripe.client().checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: args.appointmentId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: { name: 'Booking fee' },
              unit_amount: pricing.chargeCents,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: pricing.applicationFeeCents,
          metadata: {
            operator_id: args.operatorId,
            appointment_id: args.appointmentId,
          },
        },
        success_url: `${this.env.APP_URL}/booking/paid?appt=${args.appointmentId}`,
        cancel_url: `${this.env.APP_URL}/booking/cancelled?appt=${args.appointmentId}`,
      },
      { stripeAccount: eligibility.connectAccountId },
    );

    this.logger.info(
      {
        operatorId: args.operatorId,
        appointmentId: args.appointmentId,
        connectAccount: eligibility.connectAccountId,
        sessionId: session.id,
        status: session.status,
        mode: session.mode,
        hasUrl: Boolean(session.url),
        paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : typeof session.payment_intent,
        chargeCents: pricing.chargeCents,
        applicationFeeCents: pricing.applicationFeeCents,
        plan: eligibility.plan,
        takeRateBps,
      },
      'createBookingFeeCheckout: stripe session created',
    );

    // Only the hosted URL is required up front. Stripe attaches the
    // PaymentIntent id when the customer pays (it's null on the session at
    // creation), so we insert the pending row WITHOUT it and backfill from the
    // `payment_intent.succeeded` webhook (matched via PI metadata.appointment_id).
    if (!session.url) {
      throw new ExternalServiceError(
        'stripe',
        `Checkout Session missing url (session ${session.id}, status ${session.status})`,
      );
    }
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    const { data, error } = await this.supabase
      .db()
      .from('payments')
      .insert({
        operator_id: args.operatorId,
        appointment_id: args.appointmentId,
        type: 'booking_fee',
        stripe_connected_account_id: eligibility.connectAccountId,
        stripe_payment_intent_id: paymentIntentId,
        amount_cents: pricing.chargeCents,
        application_fee_cents: pricing.applicationFeeCents,
        currency: 'usd',
        status: 'pending',
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        // We've already started a checkout for this PI — surface conflict so
        // the caller can re-fetch the URL rather than create a duplicate row.
        throw new ConflictError('Payment already initiated for this checkout');
      }
      throw error;
    }

    // Stamp the appointment with the checkout session id + pending status + the
    // operator's deposit (what they collect, = charge − our platform fee). The
    // PI id is backfilled on the webhook (null here at creation).
    await this.supabase
      .db()
      .from('appointments')
      .update({
        ...(paymentIntentId ? { fee_payment_intent_id: paymentIntentId } : {}),
        fee_checkout_session_id: session.id,
        fee_status: 'pending',
        fee_cents: pricing.chargeCents - pricing.applicationFeeCents,
      })
      .eq('id', args.appointmentId);

    // Hand back a short, branded, hyphen-free link (tappable in SMS) that 302s to
    // the long Stripe Checkout URL. The raw `session.url` would break at its
    // `#`/`%` fragment, and a hyphenated UUID breaks link detection at the first `-`.
    return { url: `${this.env.API_URL}/pay/${compactUuid(args.appointmentId)}`, paymentId: data.id };
  }

  /**
   * Refund a previously-paid booking fee. CLAUDE.md §9.5: pass
   * `refund_application_fee: true` so our cut also flows back, and ensure the
   * call is scoped to the connected account.
   */
  async refundBookingFee(paymentId: string, reason?: string): Promise<void> {
    const { data: payment, error } = await this.supabase
      .db()
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();
    if (error) throw error;
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.status !== 'succeeded') {
      throw new ValidationError(`Cannot refund payment in status ${payment.status}`);
    }
    if (!payment.stripe_payment_intent_id) {
      // Succeeded payments always have the PI backfilled by the webhook; guard
      // anyway so we never call Stripe with a null payment_intent.
      throw new ValidationError('Payment has no PaymentIntent id; cannot refund');
    }

    await this.stripe.client().refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        refund_application_fee: true,
        reverse_transfer: false, // direct charge, not destination charge
        ...(reason ? { metadata: { reason } } : {}),
      },
      { stripeAccount: payment.stripe_connected_account_id },
    );

    await this.supabase
      .db()
      .from('payments')
      .update({ status: 'refunded', refunded_at: new Date().toISOString() })
      .eq('id', paymentId);
    await this.supabase
      .db()
      .from('appointments')
      .update({ fee_status: 'refunded' })
      .eq('id', payment.appointment_id);
  }
}
