import { isReturningCustomer, resumeUpdate } from './reactivation';

describe('isReturningCustomer', () => {
  it.each([
    ['canceled', 'sub_1', true],
    ['incomplete_expired', 'sub_1', true],
    ['trialing', 'sub_1', false],
    ['active', 'sub_1', false],
    ['past_due', 'sub_1', false],
    [null, null, false], // brand-new signup
    ['canceled', null, false], // no previous Stripe subscription on record (e.g. comped/cleared)
  ] as const)('status %s, sub %s → %s', (status, subId, expected) => {
    expect(isReturningCustomer({ subscription_status: status, stripe_subscription_id: subId })).toBe(
      expected,
    );
  });
});

describe('resumeUpdate', () => {
  it('clears cancel_at_period_end (portal cancel)', () => {
    expect(resumeUpdate({ cancel_at_period_end: true, cancel_at: 1_793_000_000 })).toEqual({
      cancel_at_period_end: false,
    });
  });

  it('clears an explicit cancel_at date', () => {
    expect(resumeUpdate({ cancel_at_period_end: false, cancel_at: 1_793_000_000 })).toEqual({
      cancel_at: '',
    });
  });

  it('returns null when nothing is scheduled', () => {
    expect(resumeUpdate({ cancel_at_period_end: false, cancel_at: null })).toBeNull();
  });
});
