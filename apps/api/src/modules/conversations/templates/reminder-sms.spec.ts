import { appointmentReminderSms, formatUsPhone } from './sms-templates';

describe('formatUsPhone', () => {
  it('formats a US E.164 number', () => {
    expect(formatUsPhone('+14155551234')).toBe('(415) 555-1234');
  });
  it('passes through non-US / malformed input unchanged', () => {
    expect(formatUsPhone('+445551234')).toBe('+445551234');
    expect(formatUsPhone(null)).toBe('');
  });
});

describe('appointmentReminderSms', () => {
  // The bot reschedules by text (and hands cancellations to the team), so the
  // reminder invites a reply; the business number stays as an alternative.
  it('invites a reply to reschedule or cancel, with the business number as an alternative', () => {
    const body = appointmentReminderSms('Zeus Plumbing', 'Tue 2:00 PM', '+14155551234');
    expect(body).toContain('coming up at Tue 2:00 PM');
    expect(body).toContain('Need to reschedule or cancel? Just reply to this text, or call Zeus Plumbing at (415) 555-1234.');
  });

  it('invites a reply when no business phone is available', () => {
    const body = appointmentReminderSms('Zeus Plumbing', 'Tue 2:00 PM', null);
    expect(body).toContain('Need to reschedule or cancel? Just reply to this text.');
  });
});
