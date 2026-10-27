import { specialCouponForCheckout, specialCouponTerms, specialPricingOf } from './special-pricing';

const none = {
  special_price_plan: null,
  special_price_cadence: null,
  special_price_cents: null,
  special_price_periods: null,
  special_price_coupon_id: null,
};
const soloMonthly = {
  special_price_plan: 'solo',
  special_price_cadence: 'monthly',
  special_price_cents: 5000,
  special_price_periods: 6,
  special_price_coupon_id: 'coup_special',
};

describe('specialPricingOf', () => {
  it('is null when no special pricing is set', () => {
    expect(specialPricingOf(none)).toBeNull();
  });
  it('reads the offer, including a $0 price', () => {
    expect(specialPricingOf({ ...soloMonthly, special_price_cents: 0 })).toEqual({
      plan: 'solo',
      cadence: 'monthly',
      priceCents: 0,
      periods: 6,
      couponId: 'coup_special',
    });
  });
});

describe('specialCouponForCheckout', () => {
  it('returns the coupon for the exact plan + cadence', () => {
    expect(specialCouponForCheckout(soloMonthly, 'solo', 'monthly')).toBe('coup_special');
  });
  it('returns null for another plan or cadence', () => {
    expect(specialCouponForCheckout(soloMonthly, 'crew', 'monthly')).toBeNull();
    expect(specialCouponForCheckout(soloMonthly, 'solo', 'annual')).toBeNull();
  });
  it('returns null when none is set', () => {
    expect(specialCouponForCheckout(none, 'solo', 'monthly')).toBeNull();
  });
});

describe('specialCouponTerms', () => {
  it('discounts the difference for N months on monthly', () => {
    expect(
      specialCouponTerms({ regularCents: 19900, priceCents: 5000, cadence: 'monthly', periods: 6 }),
    ).toEqual({ amountOffCents: 14900, durationInMonths: 6 });
  });
  it('counts annual periods as 12-month blocks', () => {
    expect(
      specialCouponTerms({ regularCents: 199000, priceCents: 20000, cadence: 'annual', periods: 2 }),
    ).toEqual({ amountOffCents: 179000, durationInMonths: 24 });
  });
  it('allows free (0) but not the regular price or more', () => {
    expect(
      specialCouponTerms({ regularCents: 19900, priceCents: 0, cadence: 'monthly', periods: 1 })
        .amountOffCents,
    ).toBe(19900);
    expect(() =>
      specialCouponTerms({ regularCents: 19900, priceCents: 19900, cadence: 'monthly', periods: 1 }),
    ).toThrow(/below the regular price/);
  });
  it('rejects fractional cents and zero periods', () => {
    expect(() =>
      specialCouponTerms({ regularCents: 19900, priceCents: 49.5, cadence: 'monthly', periods: 1 }),
    ).toThrow();
    expect(() =>
      specialCouponTerms({ regularCents: 19900, priceCents: 5000, cadence: 'monthly', periods: 0 }),
    ).toThrow();
  });
});
