import {
  appointmentReminderSms,
  bookingConfirmationSms,
  callWindowFor,
  describeCallWindow,
  rescheduleConfirmationSms,
} from './sms-templates';

// Vikas 2026-11-09: insurance appointments are calls, and the business may call
// anytime in the appointment window, so the texts must give the whole window.

const window = callWindowFor('2026-11-10T14:00:00Z', '2026-11-10T15:00:00Z', 'America/New_York');

describe('call window texts (office / insurance appointments)', () => {
  it('formats the window in the operator timezone', () => {
    expect(window).toEqual({ day: 'Tue, Nov 10', from: '9:00 AM', to: '10:00 AM' });
    expect(describeCallWindow(window)).toBe('Tue, Nov 10, anytime between 9:00 AM and 10:00 AM');
  });

  it('booking confirmation says the business will call within the window', () => {
    const sms = bookingConfirmationSms({
      businessName: 'Jamal Insurance',
      friendlyTime: 'Tue, Nov 10, 9:00 AM',
      icsUrl: 'https://keeprsteady.com/a/x.ics',
      callerName: 'Vikas',
      category: 'insurance',
      callWindow: window,
    });
    expect(sms).toContain("✅ Vikas, you're booked with Jamal Insurance.");
    expect(sms).toContain('Jamal Insurance will call you at this number on Tue, Nov 10, anytime between 9:00 AM and 10:00 AM.');
    expect(sms).toContain('For the call, please have handy your Medicare card');
    expect(sms).not.toContain('Please bring');
    expect(sms).toContain("please don't text us your Medicare number");
  });

  it('reschedule and 24h reminder give the window too', () => {
    const moved = rescheduleConfirmationSms({
      businessName: 'Jamal Insurance',
      friendlyTime: 'Tue, Nov 10, 9:00 AM',
      icsUrl: 'https://keeprsteady.com/a/x.ics',
      category: 'insurance',
      callWindow: window,
    });
    expect(moved).toContain('has been moved. Jamal Insurance will call you at this number on Tue, Nov 10, anytime between');
    const reminder = appointmentReminderSms('Jamal Insurance', 'Tue, Nov 10, 9:00 AM', '+18632505262', 'insurance', window);
    expect(reminder).toMatch(/^Reminder: Jamal Insurance will call you at this number on Tue, Nov 10, anytime between 9:00 AM and 10:00 AM\./);
  });

  it('trades (no call window) keep the start-time wording', () => {
    const sms = bookingConfirmationSms({
      businessName: 'Acme Plumbing',
      friendlyTime: 'Tue, Nov 10, 9:00 AM',
      icsUrl: 'https://keeprsteady.com/a/x.ics',
      category: 'plumbing',
    });
    expect(sms).toContain('for Tue, Nov 10, 9:00 AM.');
    expect(sms).not.toContain('will call you');
  });
});
