import { mapSubscriptionStatus } from './stripe-event-handlers';

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
