/**
 * Returning customers re-activate by paying: no second free trial and no
 * second Founding coupon, otherwise cancel → re-subscribe is an endless free
 * trial / $25-a-month loop. "Returning" = a previous Stripe subscription that
 * has ended. Admin special pricing still applies (an explicit staff decision).
 */
const ENDED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(['canceled', 'incomplete_expired']);

export function isReturningCustomer(op: {
  stripe_subscription_id: string | null;
  subscription_status: string | null;
}): boolean {
  return (
    !!op.stripe_subscription_id &&
    op.subscription_status != null &&
    ENDED_SUBSCRIPTION_STATUSES.has(op.subscription_status)
  );
}

/**
 * Body for `subscriptions.update` that undoes a scheduled cancellation, or null
 * when nothing is scheduled. The portal sets `cancel_at_period_end`; an explicit
 * cancel date sets `cancel_at` instead.
 */
export function resumeUpdate(sub: {
  cancel_at_period_end: boolean;
  cancel_at: number | null;
}): { cancel_at_period_end: false } | { cancel_at: '' } | null {
  if (sub.cancel_at_period_end) return { cancel_at_period_end: false };
  if (sub.cancel_at) return { cancel_at: '' };
  return null;
}
