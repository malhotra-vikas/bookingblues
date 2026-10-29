import {
  bookingFeeLine,
  describeFeeCharge,
  paymentLinkSms,
  reservationHoldSms,
} from './sms-templates';

const solo = { totalCents: 1150, depositCents: 1000, emergencyFeeCents: 0, serviceFeeCents: 150 };

describe('booking-fee SMS quote the amount the caller is charged', () => {
  it('itemises deposit + service fee', () => {
    expect(describeFeeCharge(solo)).toBe('$11.50 ($10.00 deposit + $1.50 service fee)');
  });

  it('includes the emergency fee when charged', () => {
    expect(
      describeFeeCharge({ totalCents: 3450, depositCents: 1000, emergencyFeeCents: 2000, serviceFeeCents: 450 }),
    ).toBe('$34.50 ($10.00 deposit + $20.00 emergency fee + $4.50 service fee)');
  });

  it('hold SMS quotes the Checkout total, not just the deposit', () => {
    const sms = reservationHoldSms({
      businessName: 'Acme',
      friendlyTime: 'Tue, Nov 3, 10:00 AM',
      charge: solo,
      checkoutUrl: 'https://x/pay/1',
      callerName: 'Pat Doe',
    });
    expect(sms).toContain('Pay $11.50 ($10.00 deposit + $1.50 service fee) to confirm it: https://x/pay/1');
  });

  it('confirmation fee line and Slack payment link carry the total', () => {
    expect(bookingFeeLine(solo, 'u')).toContain('$11.50 ($10.00 deposit + $1.50 service fee)');
    expect(paymentLinkSms('u', solo)).toBe(
      'Reserve your slot by paying $11.50 ($10.00 deposit + $1.50 service fee) here: u',
    );
  });
});
