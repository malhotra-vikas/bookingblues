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
