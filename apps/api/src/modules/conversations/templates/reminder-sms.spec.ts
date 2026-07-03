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
  it('directs reschedule/cancel to the operator number — never invites a bot reply', () => {
    const body = appointmentReminderSms('Zeus Plumbing', 'Tue 2:00 PM', '+14155551234');
    expect(body).toContain('coming up at Tue 2:00 PM');
    expect(body).toContain('call Zeus Plumbing directly at (415) 555-1234');
    // The bot can't reschedule — must not tell the caller to reply for it.
    expect(body.toLowerCase()).not.toContain('reply here');
  });

  it('still directs to the operator when no phone is available', () => {
    const body = appointmentReminderSms('Zeus Plumbing', 'Tue 2:00 PM', null);
    expect(body).toContain('call Zeus Plumbing directly');
    expect(body.toLowerCase()).not.toContain('reply here');
  });
});
