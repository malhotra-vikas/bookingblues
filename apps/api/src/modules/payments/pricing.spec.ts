import { computeApplicationFee } from './pricing';

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
