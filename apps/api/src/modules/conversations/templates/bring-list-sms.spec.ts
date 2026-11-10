import {
  appointmentReminderSms,
  bookingConfirmationSms,
  bringListFor,
  openingSms,
} from './sms-templates';

const base = {
  businessName: 'Insurance Test',
  friendlyTime: 'Sun, Nov 8, 10:00 AM',
  icsUrl: 'https://api.example.com/cal/abc',
  callerName: 'Vikas M',
};

describe('bring-list in caller SMS', () => {
  it('insurance confirmation lists what to bring without the caller asking', () => {
    const body = bookingConfirmationSms({ ...base, category: 'insurance' });
    expect(body).toContain("✅ Vikas, you're booked with Insurance Test for Sun, Nov 8, 10:00 AM.");
    expect(body).toContain('Please bring your Medicare card (it shows your Medicare number/MBI), a photo ID');
    expect(body).toContain('current plan card and any plan letters');
    expect(body).toContain('list of your medications');
    expect(body).toContain('Extra Help');
    // MBI is brought to the appointment, never collected by text.
    expect(body).toContain("please don't text us your Medicare number");
    expect(body).toContain('Add to your calendar: https://api.example.com/cal/abc');
  });

  it('insurance reminder repeats the bring-list', () => {
    const body = appointmentReminderSms('Insurance Test', 'Sun 10:00 AM', '+14155551234', 'insurance');
    expect(body).toContain('Please bring your Medicare card');
    expect(body).toContain('Just reply to this text, or call Insurance Test at (415) 555-1234');
  });

  it('insurance gets its own opening text; trades keep theirs', () => {
    const ins = openingSms('Insurance Test', 'insurance');
    expect(ins).toContain('Hi, this is Insurance Test — sorry we missed your call!');
    expect(ins).toContain('set up a time with one of our agents');
    expect(ins).toContain('Reply STOP to opt out. Msg & data rates may apply.');
    expect(openingSms('Zeus Plumbing', 'plumbing')).toBe(openingSms('Zeus Plumbing'));
    expect(openingSms('Zeus Plumbing')).toContain("we'll get you on the schedule");
  });

  it('trades get no bring-list (confirmation and reminder unchanged)', () => {
    const conf = bookingConfirmationSms({ ...base, businessName: 'Zeus Plumbing', category: 'plumbing' });
    expect(conf).toBe(
      "✅ Vikas, you're booked with Zeus Plumbing for Sun, Nov 8, 10:00 AM. " +
        'Add to your calendar: https://api.example.com/cal/abc',
    );
    expect(appointmentReminderSms('Zeus Plumbing', 'Tue 2:00 PM', null, 'plumbing')).not.toContain(
      'Please bring',
    );
    expect(bringListFor('plumbing')).toBeNull();
    expect(bringListFor(null)).toBeNull();
  });
});
