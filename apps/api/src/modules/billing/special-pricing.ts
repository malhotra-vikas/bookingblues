import type { Tables } from '@bookingblues/db-types';

import { ValidationError } from '../../common/errors/app-error';
import type { PlanCadence, PlanSlug } from './plan-pricing';

/**
 * Admin-set special pricing: one operator pays `priceCents` per period for
 * `periods` periods (months for monthly, years for annual) on one plan, then
 * the regular price. Stored on the operator row; billed through a per-operator
 * Stripe `duration: repeating` amount-off coupon.
 */
export interface SpecialPricing {
  readonly plan: PlanSlug;
  readonly cadence: PlanCadence;
  readonly priceCents: number;
  readonly periods: number;
  readonly couponId: string;
}

type SpecialPricingColumns = Pick<
  Tables<'operators'>,
  | 'special_price_plan'
  | 'special_price_cadence'
  | 'special_price_cents'
  | 'special_price_periods'
  | 'special_price_coupon_id'
>;

/** The operator's special pricing, or null when none is set. */
export function specialPricingOf(op: SpecialPricingColumns): SpecialPricing | null {
  if (
    !op.special_price_plan ||
    !op.special_price_cadence ||
    op.special_price_cents == null ||
    op.special_price_periods == null ||
    !op.special_price_coupon_id
  ) {
    return null;
  }
  return {
    plan: op.special_price_plan as PlanSlug,
    cadence: op.special_price_cadence as PlanCadence,
    priceCents: op.special_price_cents,
    periods: op.special_price_periods,
    couponId: op.special_price_coupon_id,
  };
}

/**
 * The special-pricing coupon to attach to a checkout, or null. It only applies
 * to the exact plan + cadence it was set for; any other choice falls back to
 * the regular checkout (and the Founding promo, if running).
 */
export function specialCouponForCheckout(
  op: SpecialPricingColumns,
  plan: PlanSlug,
  cadence: PlanCadence,
): string | null {
  const special = specialPricingOf(op);
  if (!special || special.plan !== plan || special.cadence !== cadence) return null;
  return special.couponId;
}

/**
 * Stripe coupon terms for a special price against the plan's regular price.
 *
 * Stripe's repeating coupons count in months, so N years is N×12 months. The
 * window starts when the coupon is applied (subscription creation, i.e. the
 * start of the trial), so it covers exactly N invoices: the first invoice lands
 * after the trial, and the N+1th lands after the window closes.
 */
export function specialCouponTerms(args: {
  regularCents: number;
  priceCents: number;
  cadence: PlanCadence;
  periods: number;
}): { amountOffCents: number; durationInMonths: number } {
  const { regularCents, priceCents, cadence, periods } = args;
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    throw new ValidationError('Special price must be a whole number of cents, zero or more');
  }
  if (priceCents >= regularCents) {
    throw new ValidationError(
      `Special price must be below the regular price ($${(regularCents / 100).toFixed(2)})`,
    );
  }
  if (!Number.isInteger(periods) || periods < 1) {
    throw new ValidationError('Duration must be at least 1');
  }
  return {
    amountOffCents: regularCents - priceCents,
    durationInMonths: cadence === 'annual' ? periods * 12 : periods,
  };
}
