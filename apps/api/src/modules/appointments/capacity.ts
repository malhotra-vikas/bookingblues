/**
 * Multi-truck capacity math (pure, unit-tested).
 *
 * An operator has `truckCount` trucks/techs, so up to that many appointments can
 * run concurrently. A travel buffer (default 30 min) must separate two jobs on
 * the SAME truck. We model each appointment as blocking a truck for
 * `[start, end + buffer]` — the visit plus travel-to-next. Two appointments can
 * share a truck only if their padded intervals do NOT overlap; the number of
 * padded intervals overlapping at any instant is the number of trucks needed.
 *
 * Capacity is computed from KeeprSteady's own appointments only (external Google
 * Calendar events are intentionally not counted — product decision 2026-07-10).
 */

export const TRAVEL_BUFFER_MIN = 30;

export interface Interval {
  /** epoch ms */
  start: number;
  /** epoch ms */
  end: number;
}

/** Pad an interval's END by the buffer (visit + travel-to-next). */
function padEnd(iv: Interval, bufferMs: number): Interval {
  return { start: iv.start, end: iv.end + bufferMs };
}

/**
 * Max number of intervals overlapping at any instant. Touching intervals
 * (`a.end === b.start`) do NOT overlap — an end is processed before a start at
 * the same timestamp.
 */
export function maxConcurrency(intervals: ReadonlyArray<Interval>): number {
  const points: Array<{ t: number; delta: number }> = [];
  for (const iv of intervals) {
    points.push({ t: iv.start, delta: 1 });
    points.push({ t: iv.end, delta: -1 });
  }
  // At equal times, ends (-1) before starts (+1) so touching intervals don't
  // count as concurrent.
  points.sort((a, b) => a.t - b.t || a.delta - b.delta);
  let cur = 0;
  let max = 0;
  for (const p of points) {
    cur += p.delta;
    if (cur > max) max = cur;
  }
  return max;
}

/**
 * Can a `candidate` appointment be added without exceeding `truckCount`?
 * Considers the candidate plus all existing appointments, each padded by the
 * travel buffer.
 */
export function hasCapacity(args: {
  candidate: Interval;
  existing: ReadonlyArray<Interval>;
  truckCount: number;
  bufferMin?: number;
}): boolean {
  const bufferMs = (args.bufferMin ?? TRAVEL_BUFFER_MIN) * 60_000;
  const trucks = Math.max(1, args.truckCount);
  const padded = [args.candidate, ...args.existing].map((iv) => padEnd(iv, bufferMs));
  return maxConcurrency(padded) <= trucks;
}

/**
 * Intervals within `[windowStart, windowEnd]` where ALL trucks are committed —
 * i.e. a new appointment starting then could not be placed. Used to tell the AI
 * (check_availability) which times are fully booked. Each existing appointment
 * is padded by the buffer; a time is "full" when the padded concurrency reaches
 * `truckCount` (one more would exceed it).
 */
export function fullyBookedIntervals(args: {
  existing: ReadonlyArray<Interval>;
  truckCount: number;
  windowStart: number;
  windowEnd: number;
  bufferMin?: number;
}): Interval[] {
  const bufferMs = (args.bufferMin ?? TRAVEL_BUFFER_MIN) * 60_000;
  const trucks = Math.max(1, args.truckCount);
  const padded = args.existing.map((iv) => padEnd(iv, bufferMs));

  const points: Array<{ t: number; delta: number }> = [];
  for (const iv of padded) {
    points.push({ t: iv.start, delta: 1 });
    points.push({ t: iv.end, delta: -1 });
  }
  points.sort((a, b) => a.t - b.t || a.delta - b.delta);

  const busy: Interval[] = [];
  let cur = 0;
  let fullSince: number | null = null;
  for (const p of points) {
    const wasFull = cur >= trucks;
    cur += p.delta;
    const nowFull = cur >= trucks;
    if (!wasFull && nowFull) fullSince = p.t;
    else if (wasFull && !nowFull && fullSince != null) {
      busy.push({ start: fullSince, end: p.t });
      fullSince = null;
    }
  }
  // Clip to the requested window.
  return busy
    .map((b) => ({ start: Math.max(b.start, args.windowStart), end: Math.min(b.end, args.windowEnd) }))
    .filter((b) => b.end > b.start);
}
