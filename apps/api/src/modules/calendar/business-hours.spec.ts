import { describeBusinessHours, hoursUnset, slotWithinBusinessHours } from './business-hours';

// Mon–Fri 09:00–17:00, closed weekends (the QA operator "Chicken Dinner").
const MON_FRI_9_5 = {
  mon: [{ start: '09:00', end: '17:00' }],
  tue: [{ start: '09:00', end: '17:00' }],
  wed: [{ start: '09:00', end: '17:00' }],
  thu: [{ start: '09:00', end: '17:00' }],
  fri: [{ start: '09:00', end: '17:00' }],
};
const TZ = 'America/New_York';

describe('slotWithinBusinessHours', () => {
  it('accepts a weekday slot inside hours', () => {
    // 2026-07-06 is a Monday. 9–10am ET.
    const r = slotWithinBusinessHours(
      '2026-07-06T09:00:00-04:00',
      '2026-07-06T10:00:00-04:00',
      MON_FRI_9_5,
      TZ,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a Sunday slot (closed day) — the QA bug', () => {
    // 2026-07-05 is a Sunday. The bot offered Sun 3pm and booked it.
    const r = slotWithinBusinessHours(
      '2026-07-05T15:00:00-04:00',
      '2026-07-05T16:00:00-04:00',
      MON_FRI_9_5,
      TZ,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/closed on Sun/);
  });

  it('rejects a Saturday slot (closed day)', () => {
    // 2026-07-04 is a Saturday.
    const r = slotWithinBusinessHours(
      '2026-07-04T09:00:00-04:00',
      '2026-07-04T10:00:00-04:00',
      MON_FRI_9_5,
      TZ,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/closed on Sat/);
  });

  it('rejects a weekday slot that ends after closing', () => {
    // Mon 4:30–5:30pm — ends at 17:30, past 17:00 close.
    const r = slotWithinBusinessHours(
      '2026-07-06T16:30:00-04:00',
      '2026-07-06T17:30:00-04:00',
      MON_FRI_9_5,
      TZ,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/outside Mon business hours/);
  });

  it('rejects a slot before opening', () => {
    const r = slotWithinBusinessHours(
      '2026-07-06T08:00:00-04:00',
      '2026-07-06T09:00:00-04:00',
      MON_FRI_9_5,
      TZ,
    );
    expect(r.ok).toBe(false);
  });

  it('accepts any slot when hours are unset', () => {
    const r = slotWithinBusinessHours(
      '2026-07-05T15:00:00-04:00',
      '2026-07-05T16:00:00-04:00',
      {},
      TZ,
    );
    expect(r.ok).toBe(true);
  });
});

describe('hoursUnset', () => {
  it('treats null/empty as unset', () => {
    expect(hoursUnset(null)).toBe(true);
    expect(hoursUnset({})).toBe(true);
  });
  it('treats a configured day as set', () => {
    expect(hoursUnset(MON_FRI_9_5)).toBe(false);
  });
});

describe('describeBusinessHours', () => {
  it('names open days and closed days', () => {
    const s = describeBusinessHours(MON_FRI_9_5);
    expect(s).toMatch(/Mon 09:00-17:00/);
    expect(s).toMatch(/closed Sat, Sun/);
  });
  it('reports unset', () => {
    expect(describeBusinessHours({})).toMatch(/not configured/);
  });
});
