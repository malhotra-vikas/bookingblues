import { computeApplicationFee, computeBookingFeeCharge } from './pricing';

describe('computeApplicationFee', () => {
  it('takes the larger of percent and floor', () => {
    // $1.00 fee, 10% = 10¢, but floor is 100¢. Expect 100¢ (capped down to $0.69 by Stripe processing).
    const r = computeApplicationFee({
      amountCents: 100,
      takeRateBps: 1000,
      minPlatformFeeCents: 100,
    });
    expect(r.applicationFeeCents).toBeLessThanOrEqual(r.capCents);
    expect(r.clampedToCap).toBe(true);
  });

  it('lets percent dominate when above floor', () => {
    // $50.00, 10% = $5.00, well below the cap. Expect $5.00.
    const r = computeApplicationFee({
      amountCents: 5000,
      takeRateBps: 1000,
      minPlatformFeeCents: 100,
    });
    expect(r.applicationFeeCents).toBe(500);
    expect(r.clampedToCap).toBe(false);
  });

  it('clamps to amount - Stripe processing on tiny amounts', () => {
    // $1.00 amount → processing ≈ 33¢ → cap = 67¢. Floor 100 collapses to cap.
    const r = computeApplicationFee({
      amountCents: 100,
      takeRateBps: 1000,
      minPlatformFeeCents: 100,
    });
    expect(r.applicationFeeCents).toBe(67);
    expect(r.capCents).toBe(67);
  });

  it('returns 0 when amount is 0 or negative', () => {
    expect(computeApplicationFee({ amountCents: 0, takeRateBps: 1000, minPlatformFeeCents: 100 }).applicationFeeCents).toBe(0);
    expect(computeApplicationFee({ amountCents: -10, takeRateBps: 1000, minPlatformFeeCents: 100 }).applicationFeeCents).toBe(0);
  });

  it('respects custom take rate', () => {
    // $100.00, 5% = $5.00.
    const r = computeApplicationFee({
      amountCents: 10_000,
      takeRateBps: 500,
      minPlatformFeeCents: 100,
    });
    expect(r.applicationFeeCents).toBe(500);
  });
});

describe('computeBookingFeeCharge (fee on top, paid by caller)', () => {
  it('Solo: charges deposit + 10% on top', () => {
    // $50 deposit, 10% → $5 fee. Caller pays $55, platform fee $5.
    const r = computeBookingFeeCharge({
      depositCents: 5000,
      takeRateBps: 1000,
      minPlatformFeeCents: 100,
    });
    expect(r.applicationFeeCents).toBe(500);
    expect(r.chargeCents).toBe(5500);
  });

  it('Crew: 15% on top', () => {
    const r = computeBookingFeeCharge({ depositCents: 5000, takeRateBps: 1500, minPlatformFeeCents: 100 });
    expect(r.applicationFeeCents).toBe(750);
    expect(r.chargeCents).toBe(5750);
  });

  it('Fleet: 20% on top', () => {
    const r = computeBookingFeeCharge({ depositCents: 5000, takeRateBps: 2000, minPlatformFeeCents: 100 });
    expect(r.applicationFeeCents).toBe(1000);
    expect(r.chargeCents).toBe(6000);
  });

  it('floors the platform fee at minPlatformFeeCents', () => {
    // $5 deposit, 10% = 50¢, floored to $1. Caller pays $6.
    const r = computeBookingFeeCharge({ depositCents: 500, takeRateBps: 1000, minPlatformFeeCents: 100 });
    expect(r.applicationFeeCents).toBe(100);
    expect(r.chargeCents).toBe(600);
  });

  it('app fee never exceeds charge minus Stripe processing (no rejection)', () => {
    // Even at the floor on a tiny deposit, the on-top charge keeps the fee valid.
    const r = computeBookingFeeCharge({ depositCents: 50, takeRateBps: 2000, minPlatformFeeCents: 100 });
    const stripeProcessing = Math.ceil(r.chargeCents * 0.029) + 30;
    expect(r.applicationFeeCents).toBeLessThanOrEqual(r.chargeCents - stripeProcessing);
  });

  it('returns 0 when the deposit is 0 or negative', () => {
    expect(computeBookingFeeCharge({ depositCents: 0, takeRateBps: 1000, minPlatformFeeCents: 100 }).chargeCents).toBe(0);
    expect(computeBookingFeeCharge({ depositCents: -10, takeRateBps: 1000, minPlatformFeeCents: 100 }).applicationFeeCents).toBe(0);
  });

  it('emergency fee adds to the deposit base; platform take applies to the sum', () => {
    // Solo 10%: $50 deposit + $40 emergency = $90 base. Fee = $9, caller pays $99.
    const r = computeBookingFeeCharge({
      depositCents: 5000,
      emergencyFeeCents: 4000,
      takeRateBps: 1000,
      minPlatformFeeCents: 100,
    });
    expect(r.applicationFeeCents).toBe(900);
    expect(r.chargeCents).toBe(9900);
  });

  it('charges the emergency fee even when there is no deposit', () => {
    // $0 deposit + $40 emergency, Fleet 20% = $8 fee, caller pays $48.
    const r = computeBookingFeeCharge({
      depositCents: 0,
      emergencyFeeCents: 4000,
      takeRateBps: 2000,
      minPlatformFeeCents: 100,
    });
    expect(r.applicationFeeCents).toBe(800);
    expect(r.chargeCents).toBe(4800);
  });
});
