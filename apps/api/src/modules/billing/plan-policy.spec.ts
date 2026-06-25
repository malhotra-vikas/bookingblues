import { depositModeForPlan, platformTakeRateBpsForPlan } from './plan-policy';

describe('plan-policy', () => {
  it('maps each plan to its take rate (Solo 10% / Crew 15% / Fleet 20%)', () => {
    expect(platformTakeRateBpsForPlan('solo')).toBe(1000);
    expect(platformTakeRateBpsForPlan('crew')).toBe(1500);
    expect(platformTakeRateBpsForPlan('fleet')).toBe(2000);
  });

  it('maps each plan to its deposit mode', () => {
    expect(depositModeForPlan('solo')).toBe('off-by-default');
    expect(depositModeForPlan('crew')).toBe('on-by-default');
    expect(depositModeForPlan('fleet')).toBe('mandatory');
  });

  it('returns null for unknown / legacy / null plans so callers can fall back', () => {
    expect(platformTakeRateBpsForPlan(null)).toBeNull();
    expect(platformTakeRateBpsForPlan('starter')).toBeNull();
    expect(depositModeForPlan(undefined)).toBeNull();
  });
});
