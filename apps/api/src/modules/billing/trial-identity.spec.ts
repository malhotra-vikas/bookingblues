import {
  emailDomain,
  isExemptEmail,
  normalizeEmail,
  parseExemptDomains,
  parseExemptEmails,
  trialIdentity,
} from './trial-identity';

describe('normalizeEmail', () => {
  it('collapses aliases of one inbox', () => {
    expect(normalizeEmail(' Malhotra.Vikas+1@Gmail.com ')).toBe('malhotravikas@gmail.com');
    expect(normalizeEmail('malhotravikas@googlemail.com')).toBe('malhotravikas@gmail.com');
    expect(normalizeEmail('bob+trial2@outlook.com')).toBe('bob@outlook.com');
  });

  it('keeps dots outside Gmail (they are significant there)', () => {
    expect(normalizeEmail('j.smith@acme-plumbing.com')).toBe('j.smith@acme-plumbing.com');
  });

  it('rejects malformed input', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('no-at-sign')).toBeNull();
    expect(normalizeEmail('+tag@gmail.com')).toBeNull();
    expect(normalizeEmail('user@')).toBeNull();
  });
});

describe('trialIdentity', () => {
  it('hashes aliases to the same value and never stores the raw value', () => {
    const a = trialIdentity('email', 'a.b+x@gmail.com');
    const b = trialIdentity('email', 'ab@gmail.com');
    expect(a).toEqual(b);
    expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates kinds, so a value only matches the same kind', () => {
    expect(trialIdentity('email', 'ab@gmail.com')?.hash).not.toBe(trialIdentity('google', 'ab@gmail.com')?.hash);
  });

  it('normalizes Google Calendar emails like login emails', () => {
    expect(trialIdentity('google', 'A.B@gmail.com')?.hash).toBe(trialIdentity('google', 'ab@gmail.com')?.hash);
  });

  it('returns null for empty values', () => {
    expect(trialIdentity('phone', null)).toBeNull();
    expect(trialIdentity('card', '  ')).toBeNull();
  });
});

describe('exempt mailboxes', () => {
  const emails = parseExemptEmails('malhotra.vikas@gmail.com');
  const none = new Set<string>();

  it('covers every +tag and dot alias of a listed mailbox', () => {
    for (const e of [
      'malhotra.vikas@gmail.com',
      'malhotra.vikas+1@gmail.com',
      'Malhotra.Vikas+test2@Gmail.com',
      'malhotravikas+e2e@googlemail.com',
      'm.a.l.h.o.t.r.a.vikas+9@gmail.com',
    ]) {
      expect(isExemptEmail(e, none, emails)).toBe(true);
    }
  });

  it('does not cover other people', () => {
    expect(isExemptEmail('malhotra.vikas2@gmail.com', none, emails)).toBe(false);
    expect(isExemptEmail('malhotra.vikas@outlook.com', none, emails)).toBe(false);
    expect(isExemptEmail(null, none, emails)).toBe(false);
  });

  it('still honours exempt domains', () => {
    expect(isExemptEmail('x@e2e.test', new Set(['e2e.test']), emails)).toBe(true);
  });
});

describe('exempt domains', () => {
  it('parses a comma list and reads an address domain', () => {
    expect(parseExemptDomains(' e2e.test, Example.com ,')).toEqual(new Set(['e2e.test', 'example.com']));
    expect(parseExemptDomains(undefined).size).toBe(0);
    expect(emailDomain('x@E2E.test')).toBe('e2e.test');
    expect(emailDomain(null)).toBeNull();
  });
});
