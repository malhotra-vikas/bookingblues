import { slackTextToSms } from './slack-text-to-sms';

describe('slackTextToSms', () => {
  it('strips bold from the prod 2026-11-09 reply', () => {
    expect(slackTextToSms('your aapt is booked fir *Sun, Nov 15, 12:00 PM*')).toBe(
      'your aapt is booked fir Sun, Nov 15, 12:00 PM',
    );
  });

  it('strips italic and strikethrough', () => {
    expect(slackTextToSms('see you _Friday_ at ~10~ 11am')).toBe('see you Friday at 10 11am');
  });

  it('turns Slack links into readable text', () => {
    expect(slackTextToSms('Pay here: <https://pay.example.com/x|this link>')).toBe(
      'Pay here: this link (https://pay.example.com/x)',
    );
    expect(slackTextToSms('Map: <https://maps.example.com/a_b_c>')).toBe('Map: https://maps.example.com/a_b_c');
    expect(slackTextToSms('Email <mailto:jo_ann@x.com|jo_ann@x.com>')).toBe('Email jo_ann@x.com');
    expect(slackTextToSms('Call <tel:+18485550100|(848) 555-0100>')).toBe('Call (848) 555-0100');
  });

  it('drops mentions and broadcasts, keeps channel names readable', () => {
    expect(slackTextToSms('<@U012ABC> booked it')).toBe('booked it');
    expect(slackTextToSms('<!here> done')).toBe('done');
  });

  it('decodes the HTML entities Slack sends', () => {
    expect(slackTextToSms('Tom &amp; Jerry &lt;3 &gt; 2')).toBe('Tom & Jerry <3 > 2');
  });

  it('keeps code content and leaves lone symbols and underscores in words alone', () => {
    expect(slackTextToSms('code `ABC123`')).toBe('code ABC123');
    expect(slackTextToSms('5 * 3 = 15')).toBe('5 * 3 = 15');
    expect(slackTextToSms('file_name_here and snake_case')).toBe('file_name_here and snake_case');
    expect(slackTextToSms('at 12:30:45')).toBe('at 12:30:45');
  });

  it('handles bold at the start, end and around punctuation', () => {
    expect(slackTextToSms('*Confirmed*. See you *Sunday*!')).toBe('Confirmed. See you Sunday!');
  });
});
