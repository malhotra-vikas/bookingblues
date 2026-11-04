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

/** `YYYY-MM-DD`, a real calendar date, in the past, age ≤ 120. */
const DateOfBirth = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date of birth as YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
    const now = Date.now();
    return d.getTime() < now && now - d.getTime() < 120 * 365.25 * 86_400_000;
  }, 'Not a valid past date of birth');

export const SaveIntakeAnswersArgs = z.object({
  first_name: text(60),
  last_name: text(60),
  date_of_birth: DateOfBirth,
  /** Current doctor or office; "None" if they have none, "Declined" if they'd rather not say. */
  doctor: text(200),
  /** Each prescription as the caller said it (name + strength if given). Empty = none / declined. */
  prescriptions: z.array(text(120)).max(40).default([]),
  /** True when the caller chose not to share their prescriptions. */
  prescriptions_declined: z.boolean().optional(),
});
export type SaveIntakeAnswersArgs = z.infer<typeof SaveIntakeAnswersArgs>;

/** The stored shape (what gets encrypted). */
export interface IntakeAnswers {
  readonly first_name: string;
  readonly last_name: string;
  readonly date_of_birth: string;
  readonly doctor: string;
  readonly prescriptions: ReadonlyArray<string>;
  readonly prescriptions_declined?: boolean | undefined;
}

/** Validates a decrypted payload (defends against old/corrupt rows). */
export function parseIntakeAnswers(raw: unknown): IntakeAnswers | null {
  const r = SaveIntakeAnswersArgs.safeParse(raw);
  return r.success ? r.data : null;
}

function formatDob(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

function prescriptionsLine(a: IntakeAnswers): string {
  if (a.prescriptions.length > 0) return a.prescriptions.join(', ');
  return a.prescriptions_declined ? 'Caller preferred not to share' : 'None';
}

/** Label/value rows, in the order the agent reads them. */
export function intakeAnswerRows(a: IntakeAnswers): ReadonlyArray<{ label: string; value: string }> {
  return [
    { label: 'Name', value: `${a.first_name} ${a.last_name}` },
    { label: 'Date of birth', value: formatDob(a.date_of_birth) },
    { label: 'Doctor / office', value: a.doctor },
    { label: 'Prescriptions', value: prescriptionsLine(a) },
  ];
}

/** Plain-text block for the operator's Google Calendar event description. */
export function intakeAnswersText(a: IntakeAnswers): string {
  return ['Intake answers:', ...intakeAnswerRows(a).map((r) => `${r.label}: ${r.value}`)].join('\n');
}
