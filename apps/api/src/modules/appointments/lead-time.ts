import type { Tables } from '@bookingblues/db-types';

/**
 * Minimum notice before an appointment the bot may offer or book. Prod test
 * 2026-11-09: at 4:30 PM the bot offered "today at 4:30pm". Default 2 hours;
 * a per-operator setting is planned, which is why callers go through
 * `minLeadMinutesFor` instead of using the constant directly.
 */
export const DEFAULT_MIN_LEAD_MINUTES = 120;

export function minLeadMinutesFor(_operator: Pick<Tables<'operators'>, 'id'>): number {
  return DEFAULT_MIN_LEAD_MINUTES;
}

/** Earliest start (epoch ms) the bot may offer or book for this operator. */
export function earliestBookableMs(
  operator: Pick<Tables<'operators'>, 'id'>,
  nowMs: number = Date.now(),
): number {
  return nowMs + minLeadMinutesFor(operator) * 60_000;
}
