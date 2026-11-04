import { SaveIntakeAnswersArgs, intakeAnswerRows, intakeAnswersText, parseIntakeAnswers } from './intake-answers';

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

  it.each(['04/12/1958', '1958-02-30', '2099-01-01', '1850-01-01'])('rejects date of birth %s', (dob) => {
    expect(SaveIntakeAnswersArgs.safeParse({ ...valid, date_of_birth: dob }).success).toBe(false);
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
    expect(parseIntakeAnswers({ first_name: 'x' })).toBeNull();
  });
});
