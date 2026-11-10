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

/** Oldest believable age. Anything older is a typo ("1876" for "1976"). */
export const MAX_PLAUSIBLE_AGE = 110;
/** Medicare's first enrollment window opens 3 months before 65, so under 64 this year is unusual. */
export const MEDICARE_CONFIRM_UNDER_AGE = 64;
/** Very old but possible: confirm once. */
export const CONFIRM_OVER_AGE = 100;

const DOB_FORMAT = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DOB_FORMAT_MESSAGE = 'Expected YYYY-MM-DD, YYYY-MM or YYYY — only what the caller said';
// No example year here: the model copied it verbatim ("did you mean 1976?" for
// "1765", prod 2026-11-09).
const ASK_AGAIN =
  'Ask the caller to check it NOW, before your next question. Suggest a specific year only if the typo is ' +
  'obvious (one digit off); otherwise ask them to re-type the year. ' +
  'Save it again once they correct it, or save date_of_birth_declined=true if they would rather not share. Do not book until then.';

/** A calendar-valid `YYYY[-MM[-DD]]` (no plausibility rules). */
function isRealDate(s: string): boolean {
  const [, m, d] = s.split('-');
  if (m === undefined) return true;
  const month = Number(m);
  if (month < 1 || month > 12) return false;
  if (d === undefined) return true;
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}

/** The age the person turns in the current calendar year (works for year-only dates). */
export function ageThisYear(dob: string, now: Date = new Date()): number {
  return now.getUTCFullYear() - Number(dob.slice(0, 4));
}

/**
 * Date of birth EXACTLY as precise as the caller gave it: `YYYY-MM-DD`,
 * `YYYY-MM`, or `YYYY`. A full date was required before, so a caller who said
 * only "1955" got stored as 01/01/1955 — the model invented the rest (live test
 * 2026-11-04). Partial is honest; the agent confirms the rest in person.
 *
 * When SAVING, impossible dates are rejected with an instruction the model sees
 * (prod test 2026-11-09: "1876" was only queried two messages later).
 */
const DateOfBirth = z
  .string()
  .trim()
  .regex(DOB_FORMAT, DOB_FORMAT_MESSAGE)
  // Messages never include the date itself: validation issues are logged
  // (advance.service), and a date of birth must not reach the logs.
  .superRefine((s, ctx) => {
    if (!isRealDate(s)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `That date of birth is not a real calendar date. ${ASK_AGAIN}` });
      return;
    }
    const now = new Date();
    const isFuture =
      s.length === 10
        ? new Date(`${s}T00:00:00Z`).getTime() > now.getTime()
        : Number(s.slice(0, 4)) > now.getUTCFullYear();
    if (isFuture) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `That date of birth is in the future, so it can't be right. ${ASK_AGAIN}`,
      });
      return;
    }
    if (ageThisYear(s, now) > MAX_PLAUSIBLE_AGE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `That date of birth would make the person over ${MAX_PLAUSIBLE_AGE}, so it is almost certainly a typo. ${ASK_AGAIN}`,
      });
    }
  });

/** Stored rows: format only. Plausibility is checked at save time, so an old row never stops displaying. */
const StoredDateOfBirth = z.string().trim().regex(DOB_FORMAT, DOB_FORMAT_MESSAGE);

/**
 * Every field except the first name is optional: record only what the caller
 * actually said. Requiring all of them made the model fill gaps with guesses
 * (an invented last name / birthday / "Diabetes medication").
 *
 * When the caller is booking for someone else (e.g. a parent), the name, date
 * of birth, doctor and prescriptions are THAT person's; the caller stays the
 * contact.
 */
const intakeFields = {
  first_name: text(60),
  last_name: text(60).optional(),
  /** True when the caller chose not to give their date of birth. */
  date_of_birth_declined: z.boolean().optional(),
  /** True once the caller confirmed an unusual date of birth (see dobCheck). */
  date_of_birth_confirmed: z.boolean().optional(),
  /** True when the caller wants to talk about Medicare (drives the age check). */
  about_medicare: z.boolean().optional(),
  /** True when the appointment is for someone other than the caller. */
  for_someone_else: z.boolean().optional(),
  /** Caller's relationship to that person, as they said it ("daughter", "son"). */
  caller_relationship: text(80).optional(),
  /** The caller's own name, when booking for someone else. */
  caller_name: text(80).optional(),
  /** Current doctor or office; "None" if they have none. Omit if not given. */
  doctor: text(200).optional(),
  /** True when the caller chose not to name their doctor. */
  doctor_declined: z.boolean().optional(),
  /** Each prescription (or what it's for) as the caller said it. Empty = none / declined / not asked yet. */
  prescriptions: z.array(text(120)).max(40).default([]),
  /** True when the caller chose not to share their prescriptions. */
  prescriptions_declined: z.boolean().optional(),
};

export const SaveIntakeAnswersArgs = z.object({ ...intakeFields, date_of_birth: DateOfBirth.optional() });
export type SaveIntakeAnswersArgs = z.infer<typeof SaveIntakeAnswersArgs>;

const StoredIntakeAnswers = z.object({ ...intakeFields, date_of_birth: StoredDateOfBirth.optional() });

/**
 * A caller correcting a detail on an appointment that's already booked
 * (update_appointment_details): only the changed fields, same rules as intake
 * (impossible dates rejected, no government IDs), plus an email address.
 * Switching who the appointment is for is not allowed here (hand-off instead).
 */
export const UpdateAppointmentDetailsArgs = z.object({
  appointment_id: z.string().uuid(),
  first_name: text(60).optional(),
  last_name: text(60).optional(),
  date_of_birth: DateOfBirth.optional(),
  date_of_birth_declined: z.boolean().optional(),
  date_of_birth_confirmed: z.boolean().optional(),
  doctor: text(200).optional(),
  doctor_declined: z.boolean().optional(),
  prescriptions: z.array(text(120)).max(40).optional(),
  prescriptions_declined: z.boolean().optional(),
  caller_email: z.string().trim().email().max(200).optional(),
});
export type UpdateAppointmentDetailsArgs = z.infer<typeof UpdateAppointmentDetailsArgs>;

/** Which details changed, as labels for the operator's email (never the values). */
export function changedDetailLabels(u: UpdateAppointmentDetailsArgs): string[] {
  const labels: string[] = [];
  if (u.first_name !== undefined || u.last_name !== undefined) labels.push('Name');
  if (u.date_of_birth !== undefined || u.date_of_birth_declined !== undefined) labels.push('Date of birth');
  if (u.doctor !== undefined || u.doctor_declined !== undefined) labels.push('Doctor / office');
  if (u.prescriptions !== undefined || u.prescriptions_declined !== undefined) labels.push('Prescriptions');
  if (u.caller_email !== undefined) labels.push('Email');
  return labels;
}

/** The stored shape (what gets encrypted). */
export interface IntakeAnswers {
  readonly first_name: string;
  readonly last_name?: string | undefined;
  readonly date_of_birth?: string | undefined;
  readonly date_of_birth_declined?: boolean | undefined;
  readonly date_of_birth_confirmed?: boolean | undefined;
  readonly about_medicare?: boolean | undefined;
  readonly for_someone_else?: boolean | undefined;
  readonly caller_relationship?: string | undefined;
  readonly caller_name?: string | undefined;
  readonly doctor?: string | undefined;
  readonly doctor_declined?: boolean | undefined;
  readonly prescriptions: ReadonlyArray<string>;
  readonly prescriptions_declined?: boolean | undefined;
}

/** Validates a decrypted payload (defends against old/corrupt rows). */
export function parseIntakeAnswers(raw: unknown): IntakeAnswers | null {
  const r = StoredIntakeAnswers.safeParse(raw);
  return r.success ? r.data : null;
}

export type DobCheck =
  | { readonly kind: 'confirm_young_for_medicare'; readonly age_this_year: number }
  | { readonly kind: 'confirm_very_old'; readonly age_this_year: number };

/**
 * A believable but unusual date of birth the bot should confirm ONCE before
 * booking. Never a reason to refuse: people under 65 can get Medicare through
 * disability, and eligibility is the licensed agent's call.
 */
export function dobCheck(a: IntakeAnswers, now: Date = new Date()): DobCheck | null {
  if (!a.date_of_birth || a.date_of_birth_confirmed) return null;
  const age = ageThisYear(a.date_of_birth, now);
  if (age > CONFIRM_OVER_AGE) return { kind: 'confirm_very_old', age_this_year: age };
  if (a.about_medicare && age < MEDICARE_CONFIRM_UNDER_AGE) {
    return { kind: 'confirm_young_for_medicare', age_this_year: age };
  }
  return null;
}

/** What the model must do about a DobCheck (returned in tool results). */
// The date itself is left out (the model has it): tool results may be stored
// unencrypted, and the date of birth must stay inside the encrypted intake row.
export function dobCheckInstruction(check: DobCheck, a: IntakeAnswers): string {
  const whose = a.for_someone_else ? 'their' : 'your';
  const base =
    check.kind === 'confirm_very_old' || a.for_someone_else
      ? `Before anything else, confirm ONCE, kindly, repeating only the birth YEAR they gave: "Just to double-check, ${whose} birth year is <year>. Is that right?"`
      : `Before anything else, confirm ONCE, kindly, repeating only the birth YEAR they gave: "Just to double-check, ${whose} birth year is <year>. Is that right? And is this appointment for you, or are you calling for someone else, like a parent?"`;
  return (
    `${base} If they correct it, save the new date. If they confirm, save date_of_birth_confirmed=true ` +
    '(and for_someone_else / caller_relationship / caller_name plus THAT person\'s details if it is for someone else). ' +
    "Never say or hint that they aren't eligible; the licensed agent decides that. Don't ask again after they confirm."
  );
}

/**
 * A correction call ("actually 1955") usually sends only what changed. Overlay
 * the new answers on the stored ones so earlier answers aren't wiped. An
 * explicit "declined" clears the matching value and vice versa.
 */
export function mergeIntakeAnswers(prev: IntakeAnswers | null, next: IntakeAnswers): IntakeAnswers {
  if (!prev) return next;
  // Switching to "for someone else": everything saved so far described the
  // CALLER (prod 2026-11-09: the mother got the caller's last name and birth
  // year). Keep only what this call says about the other person; the booking
  // gate then makes the bot ask for her date of birth.
  if (next.for_someone_else && !prev.for_someone_else) {
    const callerOwnName = [prev.first_name, prev.last_name].filter(Boolean).join(' ');
    return { ...next, caller_name: next.caller_name ?? callerOwnName };
  }
  const pick = <K extends keyof IntakeAnswers>(k: K): IntakeAnswers[K] =>
    next[k] !== undefined ? next[k] : prev[k];
  const prescriptions =
    next.prescriptions.length > 0 || next.prescriptions_declined ? next.prescriptions : prev.prescriptions;
  // A different date needs its own confirmation; re-sending the same date keeps it.
  const dobChanged = next.date_of_birth !== undefined && next.date_of_birth !== prev.date_of_birth;
  return {
    first_name: next.first_name,
    last_name: pick('last_name'),
    date_of_birth: next.date_of_birth_declined ? undefined : pick('date_of_birth'),
    date_of_birth_declined: next.date_of_birth ? false : pick('date_of_birth_declined'),
    date_of_birth_confirmed:
      next.date_of_birth_confirmed !== undefined
        ? next.date_of_birth_confirmed
        : dobChanged
          ? undefined
          : prev.date_of_birth_confirmed,
    about_medicare: pick('about_medicare'),
    for_someone_else: pick('for_someone_else'),
    caller_relationship: pick('caller_relationship'),
    caller_name: pick('caller_name'),
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
  // Booking for someone else: say who called, so the agent knows who to talk to.
  const bookedBy = a.for_someone_else
    ? [
        {
          label: 'Booked by',
          value:
            [a.caller_name, a.caller_relationship ? `(${a.caller_relationship})` : null]
              .filter(Boolean)
              .join(' ') || 'Someone else, calling on their behalf',
        },
      ]
    : [];
  return [
    ...bookedBy,
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
