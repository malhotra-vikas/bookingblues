import {
  SaveIntakeAnswersArgs,
  intakeAnswerRows,
  intakeAnswersText,
  mergeIntakeAnswers,
  parseIntakeAnswers,
} from './intake-answers';

const valid = {
  first_name: 'Mary',
  last_name: 'Jones',
  date_of_birth: '1958-04-12',
  doctor: 'Dr. Patel, Riverside Family Medicine',
  prescriptions: ['Metformin 500mg', 'Lisinopril 10mg'],
};

describe('SaveIntakeAnswersArgs', () => {
  it('accepts a complete answer set', () => {
    expect(SaveIntakeAnswersArgs.parse(valid)).toMatchObject(valid);
  });

  it('defaults prescriptions to an empty list', () => {
    const { prescriptions: _omit, ...rest } = valid;
    expect(SaveIntakeAnswersArgs.parse(rest).prescriptions).toEqual([]);
  });

  it.each(['04/12/1958', '1958-02-30', '2099-01-01', '1850-01-01', '1958-13', '2099', '55'])(
    'rejects date of birth %s',
    (dob) => {
      expect(SaveIntakeAnswersArgs.safeParse({ ...valid, date_of_birth: dob }).success).toBe(false);
    },
  );

  it.each(['1958', '1958-04', '1958-04-12'])('accepts a date of birth as precise as the caller gave it: %s', (dob) => {
    expect(SaveIntakeAnswersArgs.safeParse({ ...valid, date_of_birth: dob }).success).toBe(true);
  });

  it('needs only a first name — never forces the model to guess the rest', () => {
    const r = SaveIntakeAnswersArgs.parse({ first_name: 'Vikas' });
    expect(r).toEqual({ first_name: 'Vikas', prescriptions: [] });
  });

  it.each([
    ['Medicare number', { doctor: 'Dr. Patel 1EG4-TE5-MK73' }],
    ['Medicare number without dashes', { prescriptions: ['1EG4TE5MK73'] }],
    ['SSN', { last_name: 'Jones 123-45-6789' }],
  ])('rejects anything that looks like a %s', (_label, patch) => {
    expect(SaveIntakeAnswersArgs.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('does not mistake a phone number or dosage for an SSN', () => {
    expect(
      SaveIntakeAnswersArgs.safeParse({ ...valid, doctor: 'Dr. Patel (555) 123-4567', prescriptions: ['Atorvastatin 40mg'] })
        .success,
    ).toBe(true);
  });
});

describe('partial answers + corrections (live test 2026-11-04)', () => {
  it('shows a year-only birth date as such — never as 01/01', () => {
    const rows = intakeAnswerRows({ first_name: 'Vikas', last_name: undefined, date_of_birth: '1955', prescriptions: [] });
    expect(rows[0]!.value).toBe('Vikas (last name not given)');
    expect(rows[1]!.value).toBe('1955 (year only)');
    expect(rows[2]!.value).toBe('Not given');
  });

  it('shows month + year and declined values', () => {
    expect(intakeAnswerRows({ ...valid, date_of_birth: '1955-03' })[1]!.value).toBe('Mar 1955 (day not given)');
    const declined = { first_name: 'A', date_of_birth_declined: true, doctor_declined: true, prescriptions: [] };
    expect(intakeAnswerRows(declined)[1]!.value).toBe('Caller preferred not to share');
    expect(intakeAnswerRows(declined)[2]!.value).toBe('Caller preferred not to share');
  });

  it('a correction keeps earlier answers and replaces only what changed', () => {
    const first = { first_name: 'Vikas', date_of_birth: '1977', doctor: 'Dr Uthappa on Main St', prescriptions: [] };
    const merged = mergeIntakeAnswers(first, { first_name: 'Vikas', date_of_birth: '1955', prescriptions: [] });
    expect(merged.date_of_birth).toBe('1955');
    expect(merged.doctor).toBe('Dr Uthappa on Main St');
    const withRx = mergeIntakeAnswers(merged, { first_name: 'Vikas', prescriptions: ['for high BP', 'for diabetes'] });
    expect(withRx.prescriptions).toEqual(['for high BP', 'for diabetes']);
    expect(withRx.date_of_birth).toBe('1955');
  });

  it('declining after answering clears the stored value', () => {
    const merged = mergeIntakeAnswers(valid, { first_name: 'Mary', date_of_birth_declined: true, prescriptions: [] });
    expect(merged.date_of_birth).toBeUndefined();
    expect(merged.prescriptions).toEqual(valid.prescriptions);
  });
});

describe('intake answer formatting', () => {
  it('renders rows for the operator', () => {
    expect(intakeAnswerRows(valid)).toEqual([
      { label: 'Name', value: 'Mary Jones' },
      { label: 'Date of birth', value: '04/12/1958' },
      { label: 'Doctor / office', value: 'Dr. Patel, Riverside Family Medicine' },
      { label: 'Prescriptions', value: 'Metformin 500mg, Lisinopril 10mg' },
    ]);
  });

  it('distinguishes no prescriptions from declined', () => {
    expect(intakeAnswerRows({ ...valid, prescriptions: [] })[3]!.value).toBe('None');
    expect(intakeAnswerRows({ ...valid, prescriptions: [], prescriptions_declined: true })[3]!.value).toBe(
      'Caller preferred not to share',
    );
  });

  it('builds the calendar block', () => {
    expect(intakeAnswersText(valid)).toContain('Intake answers:\nName: Mary Jones\nDate of birth: 04/12/1958');
  });

  it('treats a corrupt payload as absent', () => {
    expect(parseIntakeAnswers({ last_name: 'x' })).toBeNull(); // no first name
    expect(parseIntakeAnswers('garbage')).toBeNull();
    expect(parseIntakeAnswers({ first_name: 'x', date_of_birth: '01/01/1955' })).toBeNull();
  });
});
