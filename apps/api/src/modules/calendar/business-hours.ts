/**
 * Business-hours helpers shared by the AI availability/booking path and the
 * booking service's server-side slot guard.
 *
 * `operators.business_hours` is stored as `{ mon: [{start,end}], ... }` where
 * keys are lowercase 3-letter weekdays, times are 24h "HH:MM" strings, and a
 * CLOSED day is simply absent (the settings UI only writes open days).
 *
 * Everything here resolves an instant to the OPERATOR's local wall clock via
 * `Intl.DateTimeFormat` (dependency-free, DST-correct) so a slot is judged in
 * the operator's timezone, not UTC.
 */

export interface HourWindow {
  readonly start: string;
  readonly end: string;
}
export type BusinessHours = Record<string, HourWindow[]>;

const WEEKDAY_TO_KEY: Record<string, string> = {
  Sun: 'sun',
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
};

const KEY_TO_LABEL: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

interface LocalParts {
  readonly dayKey: string;
  readonly minutes: number;
  readonly ymd: string;
}

function localParts(iso: string, timeZone: string): LocalParts {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  let hour = Number.parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // some ICU builds render midnight as "24"
  const minute = Number.parseInt(get('minute'), 10);
  return {
    dayKey: WEEKDAY_TO_KEY[weekday] ?? '',
    minutes: hour * 60 + minute,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number.parseInt(m[1]!, 10);
  const min = Number.parseInt(m[2]!, 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** True when the operator has no usable business-hours config (treat as always-open). */
export function hoursUnset(bh: BusinessHours | null | undefined): boolean {
  if (!bh) return true;
  return !DAY_ORDER.some((k) => Array.isArray(bh[k]) && bh[k]!.length > 0);
}

export type SlotCheck = { ok: true } | { ok: false; reason: string };

/**
 * Is `[startIso, endIso]` fully inside an open business-hours window, in the
 * operator's timezone? Returns a human-readable reason on failure so the AI
 * layer can feed it back to the model to re-propose. When hours are unset,
 * accepts any slot (operator hasn't constrained availability).
 */
export function slotWithinBusinessHours(
  startIso: string,
  endIso: string,
  bh: BusinessHours | null | undefined,
  timeZone: string,
): SlotCheck {
  if (hoursUnset(bh)) return { ok: true };
  const start = localParts(startIso, timeZone);
  const end = localParts(endIso, timeZone);
  if (start.ymd !== end.ymd) {
    return { ok: false, reason: 'Appointment must start and end on the same day.' };
  }
  const dayLabel = KEY_TO_LABEL[start.dayKey] ?? start.dayKey;
  const windows = bh?.[start.dayKey];
  if (!windows || windows.length === 0) {
    return { ok: false, reason: `closed on ${dayLabel} — pick a day the business is open.` };
  }
  for (const w of windows) {
    const ws = hhmmToMinutes(w.start);
    const we = hhmmToMinutes(w.end);
    if (ws == null || we == null) continue;
    if (start.minutes >= ws && end.minutes <= we) return { ok: true };
  }
  const open = windows.map((w) => `${w.start}-${w.end}`).join(', ');
  return { ok: false, reason: `outside ${dayLabel} business hours (open ${open}).` };
}

/**
 * Human-readable hours summary for the system prompt, e.g.
 * "Mon 09:00-17:00; Tue 09:00-17:00; ...; closed Sat, Sun".
 * Returns "not configured" when hours are unset.
 */
export function describeBusinessHours(bh: BusinessHours | null | undefined): string {
  if (hoursUnset(bh)) return 'not configured (accept any day/time)';
  const open: string[] = [];
  const closed: string[] = [];
  for (const k of DAY_ORDER) {
    const windows = bh?.[k];
    if (windows && windows.length > 0) {
      open.push(`${KEY_TO_LABEL[k]} ${windows.map((w) => `${w.start}-${w.end}`).join(', ')}`);
    } else {
      closed.push(KEY_TO_LABEL[k]!);
    }
  }
  let summary = open.join('; ');
  if (closed.length > 0) summary += `; closed ${closed.join(', ')}`;
  return summary;
}

/** Narrow an arbitrary jsonb value to BusinessHours (best-effort, never throws). */
export function asBusinessHours(value: unknown): BusinessHours | null {
  if (!value || typeof value !== 'object') return null;
  return value as BusinessHours;
}
