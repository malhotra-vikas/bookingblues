import {
  VOICE_CONSENT_REPROMPT_TEXT,
  VOICE_CONSENT_TEXT,
  VOICE_CONSENT_VERSION,
} from './sms-consent.dto';

/**
 * The 2026-07-16 outage was a copy-ordering bug, not a logic bug: "press 1"
 * sat ~18s in, behind the disclosure, so real callers hung up before the ask
 * and every missed call was declined (Twilio call logs: digits="" on every
 * inbound). These tests pin both halves of the fix — the ask stays in front,
 * and the disclosure stays complete — since either regressing is silent:
 * one loses every booking, the other loses the A2P consent basis.
 */
describe('VOICE_CONSENT_TEXT', () => {
  const spoken = VOICE_CONSENT_TEXT.replace('[business name]', 'Acme Plumbing');

  it('asks for the opt-in before reciting the disclosure', () => {
    const ask = spoken.toLowerCase().indexOf('press 1');
    const rates = spoken.toLowerCase().indexOf('message and data rates');
    expect(ask).toBeGreaterThanOrEqual(0);
    expect(rates).toBeGreaterThanOrEqual(0);
    expect(ask).toBeLessThan(rates);
  });

  it('reaches the ask early enough that callers do not hang up first', () => {
    // Polly.Joanna ~2.6 words/sec. The ask must land in the first few seconds,
    // not after a wall of legalese. 18s (the old wording) is what broke this.
    const wordsBeforeAsk = spoken.slice(0, spoken.toLowerCase().indexOf('press 1')).split(/\s+/).length;
    expect(wordsBeforeAsk / 2.6).toBeLessThan(10);
  });

  it('still carries every element the approved A2P campaign relies on', () => {
    const s = spoken.toLowerCase();
    expect(s).toContain('acme plumbing'); // business identity
    expect(s).toContain('message and data rates may apply');
    expect(s).toContain('stop to opt out');
    expect(s).toContain('help for help');
  });

  it('substitutes the business name, leaving no placeholder spoken aloud', () => {
    expect(spoken).not.toContain('[business name]');
  });

  it('bumps the version when the wording changes, so consent rows stay provable', () => {
    // Older rows retain the version they were captured under — see the dto.
    expect(VOICE_CONSENT_VERSION).toBe('voice-ivr-2026-07-16');
  });
});

describe('VOICE_CONSENT_REPROMPT_TEXT', () => {
  it('repeats the ask so a hesitant caller gets a second chance', () => {
    expect(VOICE_CONSENT_REPROMPT_TEXT.toLowerCase()).toContain('press 1');
  });

  it('stays short — it plays after the caller already sat through the disclosure', () => {
    expect(VOICE_CONSENT_REPROMPT_TEXT.split(/\s+/).length).toBeLessThan(25);
  });
});
