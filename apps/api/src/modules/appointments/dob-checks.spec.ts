import {
  SaveIntakeAnswersArgs,
  ageThisYear,
  dobCheck,
  dobCheckInstruction,
  intakeAnswerRows,
  mergeIntakeAnswers,
  parseIntakeAnswers,
  type IntakeAnswers,
} from './intake-answers';

// Prod tests 2026-11-09: "1876" was accepted conversationally and only queried
// two messages later; Vikas also asked that unusual-for-Medicare ages be
// confirmed once (and whether it's for someone else), never refused.

const NOW = new Date('2026-11-09T20:00:00Z');
const base: IntakeAnswers = { first_name: 'Vikas', prescriptions: [] };
const errorsFor = (dob: string): string[] => {
  const r = SaveIntakeAnswersArgs.safeParse({ first_name: 'A', date_of_birth: dob });
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe('impossible dates of birth are rejected at save time', () => {
  it('rejects 1876 (over 110) and tells the model to ask right away', () => {
    const [msg] = errorsFor('1876');
    expect(msg).toContain('over 110');
    expect(msg).toContain('Ask the caller to check it NOW');
    expect(msg).toContain('Do not book until then');
  });

  it('rejects a future year (4945) and a future full date', () => {
    expect(errorsFor('4945')[0]).toContain('in the future');
    expect(errorsFor('2099-01-01')[0]).toContain('in the future');
  });

  it('rejects dates that do not exist', () => {
    expect(errorsFor('1958-02-30')[0]).toContain('not a real calendar date');
  });

  it('never puts the date itself in the message (messages are logged)', () => {
    for (const dob of ['1876', '4945', '1958-02-30']) {
      for (const m of errorsFor(dob)) expect(m).not.toContain(dob);
    }
  });

  it('accepts believable dates, including year-only', () => {
    expect(errorsFor('1976')).toEqual([]);
    expect(errorsFor('1943-12-23')).toEqual([]);
    expect(errorsFor('1917')).toEqual([]); // 109 this year
  });

  it('an already-stored row still displays even if it would fail today', () => {
    // Plausibility is a save-time rule; reading back only checks the format.
    expect(parseIntakeAnswers({ first_name: 'A', date_of_birth: '1900', prescriptions: [] })).not.toBeNull();
  });
});

describe('dobCheck: confirm once, never refuse', () => {
  it('ageThisYear works for year-only and full dates', () => {
    expect(ageThisYear('1976', NOW)).toBe(50);
    expect(ageThisYear('1961-12-31', NOW)).toBe(65);
  });

  it('Medicare + under 64 this year → confirm (and ask if it is for someone else)', () => {
    const a = { ...base, about_medicare: true, date_of_birth: '1976' };
    const check = dobCheck(a, NOW);
    expect(check).toEqual({ kind: 'confirm_young_for_medicare', age_this_year: 50 });
    const text = dobCheckInstruction(check!, a);
    expect(text).toContain('calling for someone else');
    expect(text).toContain("Never say or hint that they aren't eligible");
    expect(text).not.toContain('1976'); // the model fills in the year itself
  });

  it('turning 64 or 65 this year is NOT flagged (enrollment opens 3 months before 65)', () => {
    expect(dobCheck({ ...base, about_medicare: true, date_of_birth: '1962' }, NOW)).toBeNull();
    expect(dobCheck({ ...base, about_medicare: true, date_of_birth: '1961-03-01' }, NOW)).toBeNull();
  });

  it('young but NOT about Medicare (e.g. life insurance) → no check', () => {
    expect(dobCheck({ ...base, about_medicare: false, date_of_birth: '1990' }, NOW)).toBeNull();
    expect(dobCheck({ ...base, date_of_birth: '1990' }, NOW)).toBeNull();
  });

  it('over 100 → confirm, whatever the topic', () => {
    expect(dobCheck({ ...base, date_of_birth: '1922' }, NOW)).toEqual({ kind: 'confirm_very_old', age_this_year: 104 });
  });

  it('once confirmed, no further check', () => {
    expect(dobCheck({ ...base, about_medicare: true, date_of_birth: '1976', date_of_birth_confirmed: true }, NOW)).toBeNull();
  });

  it('already known to be for someone else → only re-checks the year', () => {
    const a = { ...base, about_medicare: true, date_of_birth: '1976', for_someone_else: true };
    expect(dobCheckInstruction(dobCheck(a, NOW)!, a)).not.toContain('calling for someone else');
  });
});

describe('merging confirmations and someone-else details', () => {
  it('a different date clears the earlier confirmation; the same date keeps it', () => {
    const confirmed = { ...base, about_medicare: true, date_of_birth: '1976', date_of_birth_confirmed: true };
    expect(mergeIntakeAnswers(confirmed, { ...base, date_of_birth: '1946' }).date_of_birth_confirmed).toBeUndefined();
    expect(mergeIntakeAnswers(confirmed, { ...base, date_of_birth: '1976' }).date_of_birth_confirmed).toBe(true);
    expect(mergeIntakeAnswers(confirmed, { ...base, doctor: 'Dr Lee' }).date_of_birth_confirmed).toBe(true);
  });

  it('keeps for_someone_else / relationship / caller name across partial saves', () => {
    const first = mergeIntakeAnswers(null, {
      ...base,
      first_name: 'Asha',
      for_someone_else: true,
      caller_relationship: 'son',
      caller_name: 'Vikas',
    });
    const later = mergeIntakeAnswers(first, { ...base, first_name: 'Asha', doctor: 'Dr Lee' });
    expect(later).toMatchObject({ for_someone_else: true, caller_relationship: 'son', caller_name: 'Vikas', doctor: 'Dr Lee' });
  });

  it('shows "Booked by" first for the agent when it is for someone else', () => {
    const rows = intakeAnswerRows({ ...base, first_name: 'Asha', for_someone_else: true, caller_relationship: 'son', caller_name: 'Vikas' });
    expect(rows[0]).toEqual({ label: 'Booked by', value: 'Vikas (son)' });
    expect(rows[1]?.label).toBe('Name');
    expect(intakeAnswerRows(base)[0]?.label).toBe('Name');
  });
});
