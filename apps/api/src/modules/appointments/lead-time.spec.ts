import { DEFAULT_MIN_LEAD_MINUTES, earliestBookableMs, minLeadMinutesFor } from './lead-time';

describe('minimum notice (prod 2026-11-09: offered "today at 4:30pm" at 4:30 PM)', () => {
  const op = { id: 'op_1' };

  it('defaults to 2 hours', () => {
    expect(DEFAULT_MIN_LEAD_MINUTES).toBe(120);
    expect(minLeadMinutesFor(op)).toBe(120);
  });

  it('earliest bookable = now + 2 hours', () => {
    const now = Date.parse('2026-11-09T21:30:00Z');
    expect(new Date(earliestBookableMs(op, now)).toISOString()).toBe('2026-11-09T23:30:00.000Z');
  });
});
