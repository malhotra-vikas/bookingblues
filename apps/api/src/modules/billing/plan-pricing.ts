import type { Env } from '../../config/env';

export type PlanSlug = 'solo' | 'crew' | 'fleet';
export type PlanCadence = 'monthly' | 'annual';

export interface PlanAndCadence {
  readonly plan: PlanSlug;
  readonly cadence: PlanCadence;
}

type PriceEnvKey =
  | 'STRIPE_PRICE_SOLO_MONTHLY'
  | 'STRIPE_PRICE_SOLO_ANNUAL'
  | 'STRIPE_PRICE_CREW_MONTHLY'
  | 'STRIPE_PRICE_CREW_ANNUAL'
  | 'STRIPE_PRICE_FLEET_MONTHLY'
  | 'STRIPE_PRICE_FLEET_ANNUAL';

/** The six Stripe prices we sell, mapped to their plan + cadence. */
const PRICE_ENV_KEYS: ReadonlyArray<readonly [PriceEnvKey, PlanSlug, PlanCadence]> = [
  ['STRIPE_PRICE_SOLO_MONTHLY', 'solo', 'monthly'],
  ['STRIPE_PRICE_SOLO_ANNUAL', 'solo', 'annual'],
  ['STRIPE_PRICE_CREW_MONTHLY', 'crew', 'monthly'],
  ['STRIPE_PRICE_CREW_ANNUAL', 'crew', 'annual'],
  ['STRIPE_PRICE_FLEET_MONTHLY', 'fleet', 'monthly'],
  ['STRIPE_PRICE_FLEET_ANNUAL', 'fleet', 'annual'],
];

/**
 * Reverse map of Stripe price ID -> {plan, cadence}, built from env so it
 * reflects the prices configured for the current environment (test vs live).
 *
 * Stripe's active price ID is the source of truth for which plan an operator is
 * on: it stays correct even when a user switches plans through the Customer
 * Portal, which our checkout-time `subscription_data.metadata` does NOT (we set
 * that once at checkout and Stripe never updates it). Deriving the plan from the
 * price closes that gap and is also what backfills legacy operators whose
 * subscriptions predate metadata.
 */
export function buildPricePlanMap(env: Env): ReadonlyMap<string, PlanAndCadence> {
  const map = new Map<string, PlanAndCadence>();
  for (const [key, plan, cadence] of PRICE_ENV_KEYS) {
    const id = env[key];
    if (id) map.set(id, { plan, cadence });
  }
  return map;
}

/** Resolve a Stripe price ID to its plan + cadence, or null when unrecognised. */
export function planCadenceForPrice(
  priceId: string | null | undefined,
  priceMap: ReadonlyMap<string, PlanAndCadence>,
): PlanAndCadence | null {
  if (!priceId) return null;
  return priceMap.get(priceId) ?? null;
}
