import { describeLocalNow, localWallTimeToUtcIso, utcToLocalWallTime } from './zoned-time';

const NY = 'America/New_York';

describe('localWallTimeToUtcIso', () => {
  it('uses EDT (-4) before DST ends and EST (-5) after', () => {
    expect(localWallTimeToUtcIso('2026-10-30T09:00', NY)).toBe('2026-10-30T13:00:00.000Z');
    expect(localWallTimeToUtcIso('2026-11-03T09:00', NY)).toBe('2026-11-03T14:00:00.000Z');
  });

  it('ignores an offset the model supplied (wall clock wins)', () => {
    // -04:00 is wrong for Nov 3 Eastern; 9am local is still what the caller agreed to.
    expect(localWallTimeToUtcIso('2026-11-03T09:00:00-04:00', NY)).toBe('2026-11-03T14:00:00.000Z');
  });

  it('handles other zones, including no-DST Arizona', () => {
    expect(localWallTimeToUtcIso('2026-11-03T09:00', 'America/Los_Angeles')).toBe('2026-11-03T17:00:00.000Z');
    expect(localWallTimeToUtcIso('2026-07-01T09:00', 'America/Phoenix')).toBe('2026-07-01T16:00:00.000Z');
  });

  it('resolves the fall-back overlap to the first 1:30am', () => {
    expect(localWallTimeToUtcIso('2026-11-01T01:30', NY)).toBe('2026-11-01T05:30:00.000Z');
  });

  it('resolves the spring-forward gap past the jump', () => {
    expect(localWallTimeToUtcIso('2026-03-08T02:30', NY)).toBe('2026-03-08T07:30:00.000Z');
  });

  it('rejects non-datetimes', () => {
    expect(() => localWallTimeToUtcIso('tomorrow', NY)).toThrow();
  });
});

describe('utcToLocalWallTime', () => {
  it('round-trips across the DST change', () => {
    for (const local of ['2026-10-30T09:00', '2026-11-03T09:00', '2026-11-01T12:15']) {
      expect(utcToLocalWallTime(localWallTimeToUtcIso(local, NY), NY)).toBe(local);
    }
  });
});

describe('describeLocalNow', () => {
  it('renders the operator-local weekday and time, not UTC', () => {
    // 01:15 UTC Wednesday = 9:15pm Tuesday Eastern.
    expect(describeLocalNow(new Date('2026-10-28T01:15:00Z'), NY)).toBe('Tue 2026-10-27 21:15');
  });
});
