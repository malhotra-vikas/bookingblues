/**
 * Monthly usage windows. Limits reset every month, anchored on the operator's
 * billing period start (`operators.current_period_start`):
 *  - monthly plans: the window IS the Stripe billing period, so overage lines up
 *    with the renewal invoice;
 *  - annual plans: monthly windows stepped from the period start;
 *  - trials: the window starts at the trial start (the anchor moves to the
 *    first paid period when the trial converts, starting a fresh window).
 * With no anchor (period not synced yet) we fall back to the UTC calendar month.
 *
 * Months are stepped from the anchor each time (never chained), with the day
 * clamped to the month's length — the same way Stripe anchors billing dates —
 * so a Jan 31 anchor gives Feb 28, Mar 31, …
 */

export interface UsageWindow {
  readonly start: Date;
  /** Exclusive. */
  readonly end: Date;
}

function daysInMonthUtc(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** `anchor` + `months`, day clamped to the target month, time of day kept (UTC). */
export function addMonthsClamped(anchor: Date, months: number): Date {
  const total = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(anchor.getUTCDate(), daysInMonthUtc(year, month));
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    ),
  );
}

/** The usage window containing `now`. */
export function usageWindow(anchorIso: string | null | undefined, now: Date = new Date()): UsageWindow {
  const anchor = anchorIso ? new Date(anchorIso) : null;
  if (!anchor || Number.isNaN(anchor.getTime())) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }
  let k =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  // The month-difference guess can be off by one either way (day/time within the month).
  while (addMonthsClamped(anchor, k).getTime() > now.getTime()) k -= 1;
  while (addMonthsClamped(anchor, k + 1).getTime() <= now.getTime()) k += 1;
  return { start: addMonthsClamped(anchor, k), end: addMonthsClamped(anchor, k + 1) };
}

/** The window immediately before the one containing `now` (the last closed window). */
export function previousUsageWindow(
  anchorIso: string | null | undefined,
  now: Date = new Date(),
): UsageWindow {
  const current = usageWindow(anchorIso, now);
  return usageWindow(anchorIso, new Date(current.start.getTime() - 1));
}
