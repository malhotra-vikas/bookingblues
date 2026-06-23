import { callerConsentedFromGather, escapeXml } from './twilio-helpers';

describe('callerConsentedFromGather', () => {
  it('accepts DTMF "1" (with surrounding whitespace)', () => {
    expect(callerConsentedFromGather('1', undefined)).toBe(true);
    expect(callerConsentedFromGather(' 1 ', undefined)).toBe(true);
  });

  it('accepts clear affirmative speech, case-insensitively', () => {
    for (const s of ['yes', 'Yes please', 'YEAH', 'sure thing', 'okay', 'go ahead']) {
      expect(callerConsentedFromGather(undefined, s)).toBe(true);
    }
  });

  it('default-denies anything that is not an explicit opt-in', () => {
    expect(callerConsentedFromGather(undefined, undefined)).toBe(false); // no input
    expect(callerConsentedFromGather('', '')).toBe(false);
    expect(callerConsentedFromGather('2', undefined)).toBe(false); // wrong key
    expect(callerConsentedFromGather(undefined, 'no')).toBe(false);
    expect(callerConsentedFromGather(undefined, 'stop')).toBe(false);
    expect(callerConsentedFromGather(undefined, 'who is this')).toBe(false);
  });
});

describe('escapeXml', () => {
  it('escapes the five XML predefined entities', () => {
    expect(escapeXml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&apos;');
  });

  it('passes plain text through unchanged', () => {
    expect(escapeXml('Acme Plumbing')).toBe('Acme Plumbing');
  });

  it('handles ampersand-heavy business names', () => {
    expect(escapeXml('Bob & Sons HVAC')).toBe('Bob &amp; Sons HVAC');
  });
});
