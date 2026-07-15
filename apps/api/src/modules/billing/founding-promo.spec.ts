import type { Env } from '../../config/env';
import { foundingCouponForCheckout, isFoundingPromoActive } from './founding-promo';

const env = (over: Partial<Env>): Env =>
  ({
    PROMO_FOUNDING_ENDS_AT: '2026-10-01T00:00:00-04:00',
    STRIPE_COUPON_FOUNDING_SOLO: 'coup_solo',
    STRIPE_COUPON_FOUNDING_CREW: 'coup_crew',
    STRIPE_COUPON_FOUNDING_FLEET: 'coup_fleet',
    ...over,
  }) as unknown as Env;

const during = new Date('2026-08-15T12:00:00Z');
const after = new Date('2026-10-02T12:00:00Z');

describe('isFoundingPromoActive', () => {
  it('is active before the end date', () => {
    expect(isFoundingPromoActive(env({}), during)).toBe(true);
  });
  it('is inactive after the end date', () => {
    expect(isFoundingPromoActive(env({}), after)).toBe(false);
  });
  it('is off when no end date is configured', () => {
    expect(isFoundingPromoActive(env({ PROMO_FOUNDING_ENDS_AT: undefined }), during)).toBe(false);
  });
});

describe('foundingCouponForCheckout', () => {
  it('returns the plan coupon for a monthly checkout during the promo', () => {
    expect(foundingCouponForCheckout(env({}), 'solo', 'monthly', during)).toBe('coup_solo');
    expect(foundingCouponForCheckout(env({}), 'fleet', 'monthly', during)).toBe('coup_fleet');
  });
  it('returns null for annual (promo is monthly-only)', () => {
    expect(foundingCouponForCheckout(env({}), 'solo', 'annual', during)).toBeNull();
  });
  it('returns null after the promo ends', () => {
    expect(foundingCouponForCheckout(env({}), 'solo', 'monthly', after)).toBeNull();
  });
  it('returns null when the plan coupon is unset', () => {
    expect(
      foundingCouponForCheckout(env({ STRIPE_COUPON_FOUNDING_SOLO: undefined }), 'solo', 'monthly', during),
    ).toBeNull();
  });
});
