import { SubmitSurveySchema, renderSubmission } from './surveys.controller';

const ans = (code: string, label = 'Some option') => ({ code, label });

/** A minimal fully-valid submission; spread + override to build variants. */
const valid = {
  q1: ans('B', '4–7'),
  q2: ans('A', 'They call a competitor'),
  q3: [ans('A', 'Instant text reply'), ans('D', 'Automatic calendar booking')],
  q4: ans('B', 'Jobber'),
  q5: ans('A', 'Has to integrate'),
  q6: ans('C', '$200–$349'),
};

describe('SubmitSurveySchema', () => {
  it('accepts a complete anonymous submission', () => {
    const res = SubmitSurveySchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it('accepts optional contact fields and a source tag', () => {
    const res = SubmitSurveySchema.safeParse({
      ...valid,
      full_name: 'Dana Reyes',
      business_name: 'Reyes Plumbing',
      email: 'Dana@Example.COM',
      phone: '+14155550123',
      comments: 'We use QuickBooks too',
      source: 'lead-email-jul',
    });
    expect(res.success).toBe(true);
    // Emails are lowercased so replies thread to a consistent address.
    if (res.success) expect(res.data.email).toBe('dana@example.com');
  });

  it.each(['q1', 'q2', 'q4', 'q5', 'q6'] as const)('requires %s', (key) => {
    const { [key]: _omitted, ...rest } = valid;
    expect(SubmitSurveySchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a letter the question does not offer', () => {
    // q5 stops at D — G belongs to q3 only.
    expect(SubmitSurveySchema.safeParse({ ...valid, q5: ans('G') }).success).toBe(false);
    // q1 stops at E.
    expect(SubmitSurveySchema.safeParse({ ...valid, q1: ans('F') }).success).toBe(false);
  });

  it('rejects codes outside A–G entirely', () => {
    expect(SubmitSurveySchema.safeParse({ ...valid, q1: ans('Z') }).success).toBe(false);
    expect(SubmitSurveySchema.safeParse({ ...valid, q1: ans('AA') }).success).toBe(false);
  });

  it('caps q3 at three picks and rejects duplicates', () => {
    const three = [ans('A'), ans('B'), ans('C')];
    expect(SubmitSurveySchema.safeParse({ ...valid, q3: three }).success).toBe(true);
    expect(
      SubmitSurveySchema.safeParse({ ...valid, q3: [...three, ans('D')] }).success,
    ).toBe(false);
    expect(SubmitSurveySchema.safeParse({ ...valid, q3: [] }).success).toBe(false);
    expect(
      SubmitSurveySchema.safeParse({ ...valid, q3: [ans('A'), ans('A')] }).success,
    ).toBe(false);
  });

  it('rejects unknown keys (strict) so a typo never lands silently', () => {
    expect(SubmitSurveySchema.safeParse({ ...valid, q7: ans('A') }).success).toBe(false);
  });

  it('caps label length so a scripted POST cannot stuff the email', () => {
    const long = { code: 'A', label: 'x'.repeat(201) };
    expect(SubmitSurveySchema.safeParse({ ...valid, q1: long }).success).toBe(false);
  });
});

describe('renderSubmission', () => {
  it('prints every answer as "code) label"', () => {
    const body = SubmitSurveySchema.parse(valid);
    const { text } = renderSubmission(body, 'Reyes Plumbing');
    expect(text).toContain('B) 4–7');
    expect(text).toContain('A) Instant text reply');
    expect(text).toContain('D) Automatic calendar booking');
    expect(text).toContain('C) $200–$349');
  });

  it('escapes HTML in client-supplied labels and comments', () => {
    const body = SubmitSurveySchema.parse({
      ...valid,
      q1: ans('A', '<img src=x onerror=alert(1)>'),
      comments: '<script>bad()</script>',
    });
    const { html } = renderSubmission(body, 'Anonymous respondent');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('flags an anonymous response instead of rendering an empty contact table', () => {
    const body = SubmitSurveySchema.parse(valid);
    const { html } = renderSubmission(body, 'Anonymous respondent');
    expect(html).toContain('Submitted anonymously');
  });
});
