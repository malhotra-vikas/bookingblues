/**
 * Operator-local wall-clock time <-> UTC instants.
 *
 * The AI only ever speaks the operator's local wall clock ("2026-11-03T09:00")
 * — the same clock the caller lives on, since callers are inside the
 * operator's service area. It never computes a UTC offset itself: the model
 * gets DST wrong (it kept emitting `-04:00` for Eastern dates after DST ended).
 * Conversion happens here, server-side, via `Intl` (dependency-free, DST-correct).
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/** Offset of `timeZone` from UTC at instant `utcMs`, in ms (e.g. EDT → -4h). */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number =>
    Number.parseInt(parts.find((p) => p.type === type)?.value ?? '0', 10);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * True for `YYYY-MM-DDTHH:MM[:SS]`. Any trailing zone/offset is tolerated by
 * `localWallTimeToUtcIso` but ignored — see there.
 */
export function isLocalWallTime(value: string): boolean {
  return LOCAL_RE.test(value);
}

/**
 * Interpret `local` as wall-clock time in `timeZone` and return the UTC ISO
 * instant. A trailing `Z`/offset from the model is deliberately IGNORED: the
 * wall-clock digits are what the caller agreed to, the offset is the model's
 * (often wrong) arithmetic. Times in the spring-forward gap resolve to the
 * post-jump instant; times in the fall-back overlap resolve to the first one.
 */
export function localWallTimeToUtcIso(local: string, timeZone: string): string {
  const m = LOCAL_RE.exec(local);
  if (!m) throw new Error(`Not a local date-time: ${local}`);
  const wallAsUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? '0'),
  );
  // Two passes: the offset at the first guess can differ from the offset at
  // the true instant when a DST transition sits between them.
  const first = wallAsUtc - tzOffsetMs(wallAsUtc, timeZone);
  const second = wallAsUtc - tzOffsetMs(first, timeZone);
  // `second` is exact unless the wall time doesn't exist (spring-forward gap),
  // where `first` lands just past the jump.
  const exact = second + tzOffsetMs(second, timeZone) === wallAsUtc;
  return new Date(exact ? second : first).toISOString();
}

/** UTC instant → operator-local wall clock `YYYY-MM-DDTHH:MM` (no offset). */
export function utcToLocalWallTime(iso: string, timeZone: string): string {
  const ms = new Date(iso).getTime();
  return new Date(ms + tzOffsetMs(ms, timeZone)).toISOString().slice(0, 16);
}

/** "Tue 2026-10-27 21:15" in `timeZone` — the prompt's `Now` line. */
export function describeLocalNow(now: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  return `${weekday} ${utcToLocalWallTime(now.toISOString(), timeZone).replace('T', ' ')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Weekday of a local calendar date `YYYY-MM-DD` (pure date math, no timezone). */
export function weekdayOfLocalDate(ymd: string): (typeof WEEKDAYS)[number] {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

/**
 * The next `days` local dates starting today in `timeZone`, each with its
 * weekday: "Wed 2026-11-04 (today), Thu 2026-11-05, …". Given to the model so
 * it never maps a weekday to a date itself — it booked "next Tuesday" on a
 * Wednesday (prod 2026-11-04).
 */
export function describeUpcomingDates(now: Date, timeZone: string, days = 21): string {
  const today = utcToLocalWallTime(now.toISOString(), timeZone).slice(0, 10);
  const [y, m, d] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const ymd = new Date(Date.UTC(y!, m! - 1, d! + i)).toISOString().slice(0, 10);
    const label = `${weekdayOfLocalDate(ymd)} ${ymd}`;
    out.push(i === 0 ? `${label} (today)` : i === 1 ? `${label} (tomorrow)` : label);
  }
  return out.join(', ');
}

/** "Tue, Nov 10, 11:00 AM" for a local wall time `YYYY-MM-DDTHH:MM`. */
export function describeLocalWallTime(local: string): string {
  const ymd = local.slice(0, 10);
  const [, mo, d] = ymd.split('-').map(Number);
  const [h, min] = local.slice(11, 16).split(':').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h12 = ((h! + 11) % 12) + 1;
  return `${weekdayOfLocalDate(ymd)}, ${months[mo! - 1]} ${d}, ${h12}:${String(min).padStart(2, '0')} ${h! < 12 ? 'AM' : 'PM'}`;
}
