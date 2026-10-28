import type Stripe from 'stripe';

import { cancelAtIso, mapSubscriptionStatus } from './stripe-event-handlers';

describe('mapSubscriptionStatus', () => {
  it.each([
    ['trialing', 'trialing'],
    ['active', 'active'],
    ['past_due', 'past_due'],
    ['canceled', 'canceled'],
    ['incomplete', 'incomplete'],
    ['incomplete_expired', 'incomplete_expired'],
    ['unpaid', 'past_due'], // mapped to past_due
    ['paused', 'canceled'], // mapped to canceled (we don't model paused yet)
  ] as const)('maps Stripe %s → %s', (input, expected) => {
    expect(mapSubscriptionStatus(input)).toBe(expected);
  });
});

describe('cancelAtIso', () => {
  const sub = (fields: Partial<Stripe.Subscription>): Stripe.Subscription =>
    ({ cancel_at: null, cancel_at_period_end: false, current_period_end: 1_793_000_000, ...fields }) as Stripe.Subscription;

  it('is null when not scheduled to cancel', () => {
    expect(cancelAtIso(sub({}))).toBeNull();
  });

  it('uses cancel_at when Stripe sets it', () => {
    expect(cancelAtIso(sub({ cancel_at: 1_793_100_000, cancel_at_period_end: true }))).toBe(
      new Date(1_793_100_000 * 1000).toISOString(),
    );
  });

  it('falls back to period end for cancel_at_period_end without cancel_at', () => {
    expect(cancelAtIso(sub({ cancel_at_period_end: true }))).toBe(
      new Date(1_793_000_000 * 1000).toISOString(),
    );
  });
});
