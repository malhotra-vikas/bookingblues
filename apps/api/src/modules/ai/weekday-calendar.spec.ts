/**
 * Prod 2026-11-04: caller asked for "next week Tuesday", the bot offered
 * "Tuesday 11am" and booked Wed Nov 11. The model now gets a dated calendar and
 * weekday-labelled tool results instead of mapping weekdays to dates itself.
 */
import { describeLocalWallTime, describeUpcomingDates, weekdayOfLocalDate } from '../calendar/zoned-time';
import { daysInWindow } from './tool-handlers';

describe('weekday ↔ date (the "Tuesday booked as Wednesday" bug)', () => {
  it('knows Nov 10 2026 is a Tuesday and Nov 11 a Wednesday', () => {
    expect(weekdayOfLocalDate('2026-11-10')).toBe('Tue');
    expect(weekdayOfLocalDate('2026-11-11')).toBe('Wed');
  });

  it('builds the calendar from the operator-local date, not UTC', () => {
    // 02:30 UTC Nov 5 is still Wed Nov 4 in New York.
    expect(describeUpcomingDates(new Date('2026-11-05T02:30:00Z'), 'America/New_York', 3)).toBe(
      'Wed 2026-11-04 (today), Thu 2026-11-05 (tomorrow), Fri 2026-11-06',
    );
  });

  it('crosses month and DST boundaries without drifting', () => {
    // Nov 1 2026 is the DST fall-back day in the US.
    expect(describeUpcomingDates(new Date('2026-10-30T16:00:00Z'), 'America/New_York', 4)).toBe(
      'Fri 2026-10-30 (today), Sat 2026-10-31 (tomorrow), Sun 2026-11-01, Mon 2026-11-02',
    );
  });

  it('labels availability windows and booked times with the weekday', () => {
    expect(daysInWindow('2026-11-09T09:00', '2026-11-11T17:00')).toEqual([
      { date: '2026-11-09', weekday: 'Mon' },
      { date: '2026-11-10', weekday: 'Tue' },
      { date: '2026-11-11', weekday: 'Wed' },
    ]);
    expect(describeLocalWallTime('2026-11-10T11:00')).toBe('Tue, Nov 10, 11:00 AM');
    expect(describeLocalWallTime('2026-11-10T14:30')).toBe('Tue, Nov 10, 2:30 PM');
    expect(describeLocalWallTime('2026-11-10T00:15')).toBe('Tue, Nov 10, 12:15 AM');
    expect(describeLocalWallTime('2026-11-10T12:00')).toBe('Tue, Nov 10, 12:00 PM');
  });
});
