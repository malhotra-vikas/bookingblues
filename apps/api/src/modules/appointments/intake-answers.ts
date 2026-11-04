import { z } from 'zod';

/**
 * Intake answers collected by the bot for the Insurance Agencies category
 * (category-profile.ts). Health information (date of birth, doctor,
 * prescriptions): stored encrypted, never logged, never sent to Slack or the
 * caller's public calendar link. The Medicare number (MBI) and SSN are
 * deliberately NOT collected — the server rejects anything that looks like one.
 */

/** Medicare Beneficiary Identifier: 11 chars, e.g. 1EG4-TE5-MK73 (dashes optional). */
const MBI_PATTERN = /\b[1-9][AC-HJKMNP-RT-Yac-hjkmnp-rt-y][AC-HJKMNP-RT-Yac-hjkmnp-rt-y0-9]\d-?[AC-HJKMNP-RT-Yac-hjkmnp-rt-y][AC-HJKMNP-RT-Yac-hjkmnp-rt-y0-9]\d-?[AC-HJKMNP-RT-Yac-hjkmnp-rt-y]{2}\d{2}\b/;
const SSN_PATTERN = /\b\d{3}-?\d{2}-?\d{4}\b/;

const noGovernmentIds = (s: string): boolean => !MBI_PATTERN.test(s) && !SSN_PATTERN.test(s);
const GOV_ID_MESSAGE =
  'Looks like a Medicare number or SSN — never record those. Leave it out and tell the caller the agent handles that in person.';

const text = (max: number) =>
  z.string().trim().min(1).max(max).refine(noGovernmentIds, { message: GOV_ID_MESSAGE });

/**
 * Date of birth EXACTLY as precise as the caller gave it: `YYYY-MM-DD`,
 * `YYYY-MM`, or `YYYY`. A full date was required before, so a caller who said
 * only "1955" got stored as 01/01/1955 — the model invented the rest (live test
 * 2026-11-04). Partial is honest; the agent confirms the rest in person.
 */
const DateOfBirth = z
  .string()
  .trim()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'Expected YYYY-MM-DD, YYYY-MM or YYYY — only what the caller said')
  .refine((s) => {
    const [y, m, d] = s.split('-');
    const year = Number(y);
    const thisYear = new Date().getUTCFullYear();
    if (year > thisYear || year < thisYear - 120) return false;
    if (m === undefined) return true;
    const month = Number(m);
    if (month < 1 || month > 12) return false;
    if (d === undefined) return true;
    const date = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s && date.getTime() < Date.now();
  }, 'Not a valid past date of birth');

/**
 * Every field except the first name is optional: record only what the caller
 * actually said. Requiring all of them made the model fill gaps with guesses
 * (an invented last name / birthday / "Diabetes medication").
 */
export const SaveIntakeAnswersArgs = z.object({
  first_name: text(60),
  last_name: text(60).optional(),
  date_of_birth: DateOfBirth.optional(),
  /** True when the caller chose not to give their date of birth. */
  date_of_birth_declined: z.boolean().optional(),
  /** Current doctor or office; "None" if they have none. Omit if not given. */
  doctor: text(200).optional(),
  /** True when the caller chose not to name their doctor. */
  doctor_declined: z.boolean().optional(),
  /** Each prescription (or what it's for) as the caller said it. Empty = none / declined / not asked yet. */
  prescriptions: z.array(text(120)).max(40).default([]),
  /** True when the caller chose not to share their prescriptions. */
  prescriptions_declined: z.boolean().optional(),
});
export type SaveIntakeAnswersArgs = z.infer<typeof SaveIntakeAnswersArgs>;

/** The stored shape (what gets encrypted). */
export interface IntakeAnswers {
  readonly first_name: string;
  readonly last_name?: string | undefined;
  readonly date_of_birth?: string | undefined;
  readonly date_of_birth_declined?: boolean | undefined;
  readonly doctor?: string | undefined;
  readonly doctor_declined?: boolean | undefined;
  readonly prescriptions: ReadonlyArray<string>;
  readonly prescriptions_declined?: boolean | undefined;
}

/** Validates a decrypted payload (defends against old/corrupt rows). */
export function parseIntakeAnswers(raw: unknown): IntakeAnswers | null {
  const r = SaveIntakeAnswersArgs.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * A correction call ("actually 1955") usually sends only what changed. Overlay
 * the new answers on the stored ones so earlier answers aren't wiped. An
 * explicit "declined" clears the matching value and vice versa.
 */
export function mergeIntakeAnswers(prev: IntakeAnswers | null, next: IntakeAnswers): IntakeAnswers {
  if (!prev) return next;
  const pick = <K extends keyof IntakeAnswers>(k: K): IntakeAnswers[K] =>
    next[k] !== undefined ? next[k] : prev[k];
  const prescriptions =
    next.prescriptions.length > 0 || next.prescriptions_declined ? next.prescriptions : prev.prescriptions;
  return {
    first_name: next.first_name,
    last_name: pick('last_name'),
    date_of_birth: next.date_of_birth_declined ? undefined : pick('date_of_birth'),
    date_of_birth_declined: next.date_of_birth ? false : pick('date_of_birth_declined'),
    doctor: next.doctor_declined ? undefined : pick('doctor'),
    doctor_declined: next.doctor ? false : pick('doctor_declined'),
    prescriptions,
    prescriptions_declined: next.prescriptions.length > 0 ? false : pick('prescriptions_declined'),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `1958-04-12` → `04/12/1958`; `1958-04` → `Apr 1958 (day not given)`; `1958` → `1958 (year only)`. */
function formatDob(a: IntakeAnswers): string {
  if (!a.date_of_birth) return a.date_of_birth_declined ? 'Caller preferred not to share' : 'Not given';
  const [y, m, d] = a.date_of_birth.split('-');
  if (d) return `${m}/${d}/${y}`;
  if (m) return `${MONTHS[Number(m) - 1]} ${y} (day not given)`;
  return `${y} (year only)`;
}

function doctorLine(a: IntakeAnswers): string {
  if (a.doctor) return a.doctor;
  return a.doctor_declined ? 'Caller preferred not to share' : 'Not given';
}

function prescriptionsLine(a: IntakeAnswers): string {
  if (a.prescriptions.length > 0) return a.prescriptions.join(', ');
  return a.prescriptions_declined ? 'Caller preferred not to share' : 'None';
}

/** Label/value rows, in the order the agent reads them. */
export function intakeAnswerRows(a: IntakeAnswers): ReadonlyArray<{ label: string; value: string }> {
  return [
    { label: 'Name', value: a.last_name ? `${a.first_name} ${a.last_name}` : `${a.first_name} (last name not given)` },
    { label: 'Date of birth', value: formatDob(a) },
    { label: 'Doctor / office', value: doctorLine(a) },
    { label: 'Prescriptions', value: prescriptionsLine(a) },
  ];
}

/** Plain-text block for the operator's Google Calendar event description. */
export function intakeAnswersText(a: IntakeAnswers): string {
  return ['Intake answers:', ...intakeAnswerRows(a).map((r) => `${r.label}: ${r.value}`)].join('\n');
}
