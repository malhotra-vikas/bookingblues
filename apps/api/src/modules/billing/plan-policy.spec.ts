import { depositModeForPlan, platformTakeRateBpsForPlan } from './plan-policy';

describe('plan-policy', () => {
  it('maps each plan to its default take rate (Solo 15% / Crew 12% / Fleet 10%)', () => {
    expect(platformTakeRateBpsForPlan('solo')).toBe(1500);
    expect(platformTakeRateBpsForPlan('crew')).toBe(1200);
    expect(platformTakeRateBpsForPlan('fleet')).toBe(1000);
  });

  it('prefers an env override when provided (including 0)', () => {
    const overrides = { solo: 900, crew: 0 };
    expect(platformTakeRateBpsForPlan('solo', overrides)).toBe(900);
    expect(platformTakeRateBpsForPlan('crew', overrides)).toBe(0);
    // No override for fleet → falls back to the compiled default.
    expect(platformTakeRateBpsForPlan('fleet', overrides)).toBe(1000);
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
