import type { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';
import type { Database } from '@bookingblues/db-types';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConnectHandlerDeps {
  readonly db: SupabaseClient<Database>;
  readonly logger: PinoLogger;
  /** Finalizes a reserved booking once its fee is paid (Reserve→Pay→Confirm). */
  readonly confirmPaidBooking: (appointmentId: string) => Promise<void>;
}

/**
 * `account.updated` arrives as the operator advances through Express
 * onboarding. Mirror the relevant capability flags onto our `operators` row
 * so the eligibility gate (CLAUDE.md §9.5) sees the latest state.
 *
 * Cross-reference the connected-account id against `stripe_connect_account_id`
 * before mutating, per CLAUDE.md §11.13.
 */
export async function onAccountUpdated(
  account: Stripe.Account,
  envelopeAccountId: string,
  deps: ConnectHandlerDeps,
): Promise<void> {
  if (account.id !== envelopeAccountId) {
    deps.logger.warn(
      { envelopeAccountId, payloadAccountId: account.id },
      'account.updated envelope/payload mismatch — rejecting',
    );
    return;
  }

  const { data: operator, error: lookupErr } = await deps.db
    .from('operators')
    .select('id')
    .eq('stripe_connect_account_id', account.id)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!operator) {
    deps.logger.warn(
      { accountId: account.id },
      'No operator matches connected account; ignoring',
    );
    return;
  }

  const { error } = await deps.db
    .from('operators')
    .update({
      stripe_connect_charges_enabled: account.charges_enabled ?? false,
      stripe_connect_payouts_enabled: account.payouts_enabled ?? false,
    })
    .eq('id', operator.id);
  if (error) throw error;
}

export async function onPaymentIntentSucceeded(
  pi: Stripe.PaymentIntent,
  envelopeAccountId: string,
  deps: ConnectHandlerDeps,
): Promise<void> {
  const { data: payment, error: lookupErr } = await deps.db
    .from('payments')
    .select('id, appointment_id, stripe_connected_account_id')
    .eq('stripe_payment_intent_id', pi.id)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!payment) {
    deps.logger.warn(
      { paymentIntentId: pi.id, envelopeAccountId },
      'No payment row matches PI; ignoring',
    );
    return;
  }
  if (payment.stripe_connected_account_id !== envelopeAccountId) {
    deps.logger.warn(
      { paymentIntentId: pi.id, expected: payment.stripe_connected_account_id, got: envelopeAccountId },
      'PI delivery from wrong connected account — rejecting',
    );
    return;
  }

  const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;

  await deps.db
    .from('payments')
    .update({
      status: 'succeeded',
      ...(chargeId ? { stripe_charge_id: chargeId } : {}),
      raw_event: pi as unknown as Database['public']['Tables']['payments']['Row']['raw_event'],
    })
    .eq('id', payment.id);

  await deps.db
    .from('appointments')
    .update({ fee_status: 'paid' })
    .eq('id', payment.appointment_id);

  // Reserve→Pay→Confirm: the slot was only HELD (status 'proposed', no calendar
  // event) pending this payment. Now finalize — create the Google event, send
  // confirmation, complete the conversation. Idempotent on retries.
  await deps.confirmPaidBooking(payment.appointment_id);
}

export async function onChargeRefunded(
  charge: Stripe.Charge,
  envelopeAccountId: string,
  deps: ConnectHandlerDeps,
): Promise<void> {
  const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!piId) return;

  const { data: payment, error: lookupErr } = await deps.db
    .from('payments')
    .select('id, appointment_id, stripe_connected_account_id, amount_cents')
    .eq('stripe_payment_intent_id', piId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;
  if (!payment) return;
  if (payment.stripe_connected_account_id !== envelopeAccountId) return;

  const fullyRefunded = charge.amount_refunded >= payment.amount_cents;
  await deps.db
    .from('payments')
    .update({
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      refunded_at: new Date().toISOString(),
    })
    .eq('id', payment.id);
  await deps.db
    .from('appointments')
    .update({ fee_status: fullyRefunded ? 'refunded' : 'paid' })
    .eq('id', payment.appointment_id);
}

export async function dispatchConnectEvent(
  event: Stripe.Event,
  envelopeAccountId: string,
  deps: ConnectHandlerDeps,
): Promise<void> {
  switch (event.type) {
    case 'account.updated':
      await onAccountUpdated(event.data.object, envelopeAccountId, deps);
      return;
    case 'payment_intent.succeeded':
      await onPaymentIntentSucceeded(event.data.object, envelopeAccountId, deps);
      return;
    case 'charge.refunded':
      await onChargeRefunded(event.data.object, envelopeAccountId, deps);
      return;
    default:
      return;
  }
}
