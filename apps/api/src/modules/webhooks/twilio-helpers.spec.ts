import { escapeXml } from './twilio-helpers';

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
