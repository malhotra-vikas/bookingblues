import type { Env } from '../../config/env';
import type { PlanCadence, PlanSlug } from './plan-pricing';

/**
 * Founding Member promo: $25 first month on MONTHLY plans for signups through
 * `PROMO_FOUNDING_ENDS_AT`. Implemented as per-plan Stripe `duration: once`
 * coupons (amount_off = planPrice − $25) attached to the checkout session; the
 * discount lands on the first post-trial invoice only.
 *
 * Single source of truth so the API (checkout) and web (banners) agree.
 */

/** Is the promo currently running? Requires an end date that is in the future. */
export function isFoundingPromoActive(env: Env, now: Date = new Date()): boolean {
  const endsAt = env.PROMO_FOUNDING_ENDS_AT;
  if (!endsAt) return false;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return false;
  return now.getTime() < end.getTime();
}

/** The founding-member coupon id for a plan, or null if unset/not applicable. */
export function foundingCouponForPlan(env: Env, plan: PlanSlug): string | null {
  switch (plan) {
    case 'solo':
      return env.STRIPE_COUPON_FOUNDING_SOLO ?? null;
    case 'crew':
      return env.STRIPE_COUPON_FOUNDING_CREW ?? null;
    case 'fleet':
      return env.STRIPE_COUPON_FOUNDING_FLEET ?? null;
    default:
      return null;
  }
}

/**
 * The coupon to attach to a checkout, or null. Applies only to MONTHLY cadence
 * while the promo is active and a coupon is configured for the plan.
 */
export function foundingCouponForCheckout(
  env: Env,
  plan: PlanSlug,
  cadence: PlanCadence,
  now: Date = new Date(),
): string | null {
  if (cadence !== 'monthly') return null;
  if (!isFoundingPromoActive(env, now)) return null;
  return foundingCouponForPlan(env, plan);
}
