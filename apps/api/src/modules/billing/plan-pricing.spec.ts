import type { Env } from '../../config/env';
import { buildPricePlanMap, planCadenceForPrice } from './plan-pricing';

const env = {
  STRIPE_PRICE_SOLO_MONTHLY: 'price_solo_m',
  STRIPE_PRICE_SOLO_ANNUAL: 'price_solo_a',
  STRIPE_PRICE_CREW_MONTHLY: 'price_crew_m',
  STRIPE_PRICE_CREW_ANNUAL: 'price_crew_a',
  STRIPE_PRICE_FLEET_MONTHLY: 'price_fleet_m',
  STRIPE_PRICE_FLEET_ANNUAL: 'price_fleet_a',
} as unknown as Env;

describe('buildPricePlanMap', () => {
  it('maps every configured price ID to its plan + cadence', () => {
    const map = buildPricePlanMap(env);
    expect(map.size).toBe(6);
    expect(map.get('price_solo_m')).toEqual({ plan: 'solo', cadence: 'monthly' });
    expect(map.get('price_crew_a')).toEqual({ plan: 'crew', cadence: 'annual' });
    expect(map.get('price_fleet_m')).toEqual({ plan: 'fleet', cadence: 'monthly' });
  });

  it('skips price keys that are unset (env tolerant)', () => {
    const partial = { STRIPE_PRICE_SOLO_MONTHLY: 'price_solo_m' } as unknown as Env;
    const map = buildPricePlanMap(partial);
    expect(map.size).toBe(1);
    expect(map.get('price_solo_m')).toEqual({ plan: 'solo', cadence: 'monthly' });
  });
});

describe('planCadenceForPrice', () => {
  const map = buildPricePlanMap(env);

  it('resolves a known price ID', () => {
    expect(planCadenceForPrice('price_fleet_a', map)).toEqual({ plan: 'fleet', cadence: 'annual' });
  });

  it('returns null for an unknown price ID (legacy Starter/Pro, third-party subs)', () => {
    expect(planCadenceForPrice('price_legacy_pro', map)).toBeNull();
  });

  it('returns null when the price ID is null/undefined', () => {
    expect(planCadenceForPrice(null, map)).toBeNull();
    expect(planCadenceForPrice(undefined, map)).toBeNull();
  });
});
