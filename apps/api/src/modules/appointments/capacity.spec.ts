import { fullyBookedIntervals, hasCapacity, maxConcurrency } from './capacity';

const H = 3_600_000; // 1 hour in ms
const base = Date.UTC(2026, 6, 13, 9, 0, 0); // Mon 9:00 UTC
const at = (hoursFromBase: number, durHours = 1) => ({
  start: base + hoursFromBase * H,
  end: base + (hoursFromBase + durHours) * H,
});

describe('maxConcurrency', () => {
  it('counts overlapping intervals', () => {
    expect(maxConcurrency([at(0), at(0.5), at(2)])).toBe(2); // first two overlap
  });
  it('treats touching intervals as non-overlapping', () => {
    expect(maxConcurrency([at(0), at(1)])).toBe(1); // 9-10 and 10-11 touch, not overlap
  });
});

describe('hasCapacity', () => {
  // 1 truck, 30-min buffer.
  it('rejects a second job overlapping the same truck window', () => {
    expect(hasCapacity({ candidate: at(0.5), existing: [at(0)], truckCount: 1 })).toBe(false);
  });
  it('rejects a back-to-back job inside the travel buffer (only 15 min gap)', () => {
    // A 9-10 (padded to 10:30). Candidate 10:15-11:15 → within buffer → needs 2 trucks.
    expect(hasCapacity({ candidate: at(1.25), existing: [at(0)], truckCount: 1 })).toBe(false);
  });
  it('accepts a job after the full travel buffer (30 min gap)', () => {
    // A 9-10 (padded 10:30). Candidate 10:30-11:30 → exactly buffer → 1 truck ok.
    expect(hasCapacity({ candidate: at(1.5), existing: [at(0)], truckCount: 1 })).toBe(true);
  });

  // 3 trucks.
  it('allows up to truckCount concurrent jobs', () => {
    const existing = [at(0), at(0), at(0)]; // 3 at once
    // 4th concurrent → exceeds 3 trucks
    expect(hasCapacity({ candidate: at(0), existing, truckCount: 3 })).toBe(false);
    // but 3 concurrent is fine
    expect(hasCapacity({ candidate: at(0), existing: [at(0), at(0)], truckCount: 3 })).toBe(true);
  });
});

describe('fullyBookedIntervals', () => {
  it('reports the window where all trucks are committed (incl. buffer)', () => {
    // 1 truck, one appt 9-10 → padded busy 9-10:30.
    const busy = fullyBookedIntervals({
      existing: [at(0)],
      truckCount: 1,
      windowStart: base,
      windowEnd: base + 8 * H,
    });
    expect(busy).toHaveLength(1);
    expect(busy[0]!.start).toBe(at(0).start);
    expect(busy[0]!.end).toBe(at(0).end + 30 * 60_000); // +30 buffer
  });

  it('is empty when trucks exceed concurrent load', () => {
    // 2 trucks, one appt → never fully booked.
    const busy = fullyBookedIntervals({
      existing: [at(0)],
      truckCount: 2,
      windowStart: base,
      windowEnd: base + 8 * H,
    });
    expect(busy).toHaveLength(0);
  });
});
