import type { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';
import type { Database } from '@bookingblues/db-types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { type PlanAndCadence, planCadenceForPrice } from '../billing/plan-pricing';

type SubscriptionStatus = Database['public']['Enums']['subscription_status'];

/**
 * Map Stripe's subscription status to the DB enum (CLAUDE.md §8).
 * 'unpaid' → past_due (treated as a billing-failure state).
 * 'paused' → canceled (paused subs are unusual; we don't yet support a paused
 * mode — operator should re-subscribe to resume).
 */
export function mapSubscriptionStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
  switch (s) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
      return 'incomplete';
    case 'incomplete_expired':
      return 'incomplete_expired';
    case 'unpaid':
      return 'past_due';
    case 'paused':
      return 'canceled';
  }
}

function unixToIso(unix: number | null | undefined): string | null {
  return unix ? new Date(unix * 1000).toISOString() : null;
}

export interface HandlerDeps {
  readonly db: SupabaseClient<Database>;
  readonly logger: PinoLogger;
  /**
   * Stripe price ID -> {plan, cadence}, built from env. Lets the subscription
   * handler derive the operator's plan from Stripe's source-of-truth active
   * price rather than the (mutable, sometimes-absent) checkout metadata.
   */
  readonly priceMap?: ReadonlyMap<string, PlanAndCadence>;
}

export async function onCheckoutCompleted(
  session: Stripe.Checkout.Session,
  deps: HandlerDeps,
): Promise<void> {
  const operatorId = session.client_reference_id;
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;

  if (!operatorId) {
    deps.logger.warn(
      { eventType: 'checkout.session.completed', sessionId: session.id },
      'checkout.session.completed without client_reference_id; ignoring',
    );
    return;
  }
  if (!subscriptionId) {
    // Non-subscription mode session — should not happen for this flow, but skip.
    return;
  }

  const { error } = await deps.db
    .from('operators')
    .update({ stripe_subscription_id: subscriptionId })
    .eq('id', operatorId);
  if (error) throw error;
}

/**
 * Narrow `subscription.metadata.plan` / `.cadence` to the values we set at
 * checkout. Anything we don't recognise — including pre-migration
 * Starter/Pro subs or third-party-created subscriptions — is stored as
 * null so we never persist garbage.
 */
function planFromMetadata(meta: Stripe.Metadata | null): 'solo' | 'crew' | 'fleet' | null {
  const v = meta?.['plan'];
  return v === 'solo' || v === 'crew' || v === 'fleet' ? v : null;
}
function cadenceFromMetadata(meta: Stripe.Metadata | null): 'monthly' | 'annual' | null {
  const v = meta?.['cadence'];
  return v === 'monthly' || v === 'annual' ? v : null;
}

export async function onSubscriptionUpserted(
  sub: Stripe.Subscription,
  deps: HandlerDeps,
): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const { data: operator, error: lookupErr } = await deps.db
    .from('operators')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!operator) {
    deps.logger.warn(
      { customerId, subscriptionId: sub.id, status: sub.status },
      'No operator matches subscription customer; ignoring',
    );
    return;
  }

  // Stripe is the source of truth for the active price ID — pull it off the
  // subscription item rather than trusting metadata, which a user can mutate
  // (or which is simply absent on legacy / third-party subs) through the
  // Customer Portal when switching plans. Derive plan + cadence from that price;
  // fall back to checkout metadata only for prices we don't recognise.
  const stripePriceId = sub.items.data[0]?.price.id ?? null;
  const fromPrice = deps.priceMap ? planCadenceForPrice(stripePriceId, deps.priceMap) : null;
  const plan = fromPrice?.plan ?? planFromMetadata(sub.metadata);
  const cadence = fromPrice?.cadence ?? cadenceFromMetadata(sub.metadata);

  const { error } = await deps.db
    .from('operators')
    .update({
      stripe_subscription_id: sub.id,
      subscription_status: mapSubscriptionStatus(sub.status),
      trial_ends_at: unixToIso(sub.trial_end),
      // Current billing cycle — usage metering counts conversations in this
      // window (during a trial these span the trial). Falls back to calendar
      // month in the usage query when null.
      current_period_start: unixToIso(sub.current_period_start),
      current_period_end: unixToIso(sub.current_period_end),
      ...(plan != null ? { plan } : {}),
      ...(cadence != null ? { plan_cadence: cadence } : {}),
      ...(stripePriceId != null ? { stripe_price_id: stripePriceId } : {}),
    })
    .eq('id', operator.id);
  if (error) throw error;
}

export async function onSubscriptionDeleted(
  sub: Stripe.Subscription,
  deps: HandlerDeps,
): Promise<void> {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const { error } = await deps.db
    .from('operators')
    .update({
      subscription_status: 'canceled',
      trial_ends_at: null,
    })
    .eq('stripe_customer_id', customerId);
  if (error) throw error;
}

export async function dispatchPlatformEvent(
  event: Stripe.Event,
  deps: HandlerDeps,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(event.data.object, deps);
      return;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await onSubscriptionUpserted(event.data.object, deps);
      return;
    case 'customer.subscription.deleted':
      await onSubscriptionDeleted(event.data.object, deps);
      return;
    case 'customer.subscription.trial_will_end':
      // Slice 10 (Resend) will send the day-4 reminder email here.
      deps.logger.info(
        { subscriptionId: (event.data.object as Stripe.Subscription).id },
        'trial_will_end — TODO: send reminder email (Slice 10)',
      );
      return;
    case 'invoice.payment_succeeded':
    case 'invoice.payment_failed':
      // Status transitions arrive via customer.subscription.updated; nothing
      // to do here for now beyond the audit trail in webhook_events.
      return;
    default:
      // Unhandled types are fine — we ack 200 and move on.
      return;
  }
}
