import {
  overageFor,
  overLimitPolicyForPlan,
  thresholdsReached,
} from '../billing/plan-limits';
import { addMonthsClamped, previousUsageWindow, usageWindow } from './usage-window';

const iso = (d: Date): string => d.toISOString();

describe('usageWindow', () => {
  it('falls back to the UTC calendar month without an anchor', () => {
    const w = usageWindow(null, new Date('2026-11-17T12:00:00Z'));
    expect(iso(w.start)).toBe('2026-11-01T00:00:00.000Z');
    expect(iso(w.end)).toBe('2026-12-01T00:00:00.000Z');
  });

  it('equals the billing period on a monthly plan', () => {
    const w = usageWindow('2026-11-03T15:30:00Z', new Date('2026-11-20T00:00:00Z'));
    expect(iso(w.start)).toBe('2026-11-03T15:30:00.000Z');
    expect(iso(w.end)).toBe('2026-12-03T15:30:00.000Z');
  });

  it('steps monthly windows from an annual period start', () => {
    const w = usageWindow('2026-03-10T00:00:00Z', new Date('2026-08-09T23:59:59Z'));
    expect(iso(w.start)).toBe('2026-07-10T00:00:00.000Z');
    expect(iso(w.end)).toBe('2026-08-10T00:00:00.000Z');
  });

  it('starts a new window exactly at the boundary', () => {
    const w = usageWindow('2026-03-10T00:00:00Z', new Date('2026-08-10T00:00:00Z'));
    expect(iso(w.start)).toBe('2026-08-10T00:00:00.000Z');
  });

  it('clamps month-end anchors without drifting', () => {
    expect(iso(addMonthsClamped(new Date('2026-01-31T00:00:00Z'), 1))).toBe('2026-02-28T00:00:00.000Z');
    expect(iso(addMonthsClamped(new Date('2026-01-31T00:00:00Z'), 2))).toBe('2026-03-31T00:00:00.000Z');
    const w = usageWindow('2026-01-31T00:00:00Z', new Date('2026-03-15T00:00:00Z'));
    expect(iso(w.start)).toBe('2026-02-28T00:00:00.000Z');
    expect(iso(w.end)).toBe('2026-03-31T00:00:00.000Z');
  });

  it('handles an anchor in the future (steps backwards)', () => {
    const w = usageWindow('2026-12-05T00:00:00Z', new Date('2026-11-20T00:00:00Z'));
    expect(iso(w.start)).toBe('2026-11-05T00:00:00.000Z');
    expect(iso(w.end)).toBe('2026-12-05T00:00:00.000Z');
  });

  it('previousUsageWindow is the last closed window', () => {
    const w = previousUsageWindow('2026-03-10T00:00:00Z', new Date('2026-08-12T00:00:00Z'));
    expect(iso(w.start)).toBe('2026-07-10T00:00:00.000Z');
    expect(iso(w.end)).toBe('2026-08-10T00:00:00.000Z');
  });
});

describe('plan limits', () => {
  it('Solo blocks, Crew/Fleet pay overage, unknown plans are unenforced', () => {
    expect(overLimitPolicyForPlan('solo')).toBe('block');
    expect(overLimitPolicyForPlan('crew')).toBe('overage');
    expect(overLimitPolicyForPlan('fleet')).toBe('overage');
    expect(overLimitPolicyForPlan(null)).toBeNull();
  });

  it('bills $100 per started batch of 50', () => {
    expect(overageFor(500, 500)).toEqual({ extraPeople: 0, batches: 0, amountCents: 0 });
    expect(overageFor(501, 500)).toEqual({ extraPeople: 1, batches: 1, amountCents: 10_000 });
    expect(overageFor(550, 500)).toEqual({ extraPeople: 50, batches: 1, amountCents: 10_000 });
    expect(overageFor(551, 500)).toEqual({ extraPeople: 51, batches: 2, amountCents: 20_000 });
    expect(overageFor(10, 80)).toEqual({ extraPeople: 0, batches: 0, amountCents: 0 });
  });

  it('reaches 80% / 100% thresholds', () => {
    expect(thresholdsReached(63, 80)).toEqual([]);
    expect(thresholdsReached(64, 80)).toEqual([80]);
    expect(thresholdsReached(80, 80)).toEqual([80, 100]);
    expect(thresholdsReached(400, 500)).toEqual([80]);
  });
});
