import { PLANS, type PlanSlug } from './brand';

/** Admin-set special pricing columns on the operator row (see the API's special-pricing.ts). */
export interface SpecialPricingFields {
  special_price_plan: string | null;
  special_price_cadence: string | null;
  special_price_cents: number | null;
  special_price_periods: number | null;
}

export interface SpecialPricing {
  plan: PlanSlug;
  planName: string;
  cadence: 'monthly' | 'annual';
  priceUsd: number;
  periods: number;
}

export function specialPricingOf(op: SpecialPricingFields | null | undefined): SpecialPricing | null {
  if (
    !op?.special_price_plan ||
    !op.special_price_cadence ||
    op.special_price_cents == null ||
    op.special_price_periods == null
  ) {
    return null;
  }
  const plan = PLANS.find((p) => p.slug === op.special_price_plan);
  if (!plan) return null;
  return {
    plan: plan.slug,
    planName: plan.name,
    cadence: op.special_price_cadence === 'annual' ? 'annual' : 'monthly',
    priceUsd: op.special_price_cents / 100,
    periods: op.special_price_periods,
  };
}

function money(usd: number): string {
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(usd) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "$50/mo for 6 months" or "$200/yr for 2 years". */
export function specialPriceLabel(s: SpecialPricing): string {
  const unit = s.cadence === 'annual' ? 'yr' : 'mo';
  const span = s.cadence === 'annual' ? 'year' : 'month';
  return `${money(s.priceUsd)}/${unit} for ${s.periods} ${span}${s.periods === 1 ? '' : 's'}`;
}

/** The regular price the special pricing reverts to, e.g. "$199/mo". */
export function regularPriceLabel(s: SpecialPricing): string {
  const plan = PLANS.find((p) => p.slug === s.plan);
  if (!plan) return '';
  return s.cadence === 'annual'
    ? `${money(plan.annualPriceUsd)}/yr`
    : `${money(plan.monthlyPriceUsd)}/mo`;
}
