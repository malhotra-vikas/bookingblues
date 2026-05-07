import type { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';
import type { Database } from '@bookingblues/db-types';
import type { SupabaseClient } from '@supabase/supabase-js';

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

  const { error } = await deps.db
    .from('operators')
    .update({
      stripe_subscription_id: sub.id,
      subscription_status: mapSubscriptionStatus(sub.status),
      trial_ends_at: unixToIso(sub.trial_end),
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
