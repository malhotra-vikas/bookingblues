import { createHash } from 'node:crypto';

/**
 * Identifiers that mark "the same person" across accounts for the one-free-trial
 * rule (trial-guard.service.ts). Pure helpers; stored only as hashes.
 */
export type TrialIdentityKind = 'email' | 'phone' | 'card' | 'google';

export interface TrialIdentity {
  readonly kind: TrialIdentityKind;
  readonly hash: string;
}

const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

/**
 * Canonical mailbox for an address, so aliases of one inbox collide:
 * lowercase, `+tag` dropped (Gmail, Outlook, iCloud, Fastmail… all deliver
 * `a+x@` to `a@`), and Gmail's ignored dots removed.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  let local = email.slice(0, at).split('+')[0] ?? '';
  let domain = email.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    domain = 'gmail.com';
    local = local.replaceAll('.', '');
  }
  return local ? `${local}@${domain}` : null;
}

export function emailDomain(raw: string | null | undefined): string | null {
  const email = (raw ?? '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : null;
}

/** Hash of `kind:value`; null when the value is empty. */
export function trialIdentity(kind: TrialIdentityKind, value: string | null | undefined): TrialIdentity | null {
  const v = (kind === 'email' || kind === 'google' ? normalizeEmail(value) : (value ?? '').trim()) ?? '';
  if (!v) return null;
  return { kind, hash: createHash('sha256').update(`${kind}:${v}`).digest('hex') };
}

/** Normalized mailboxes from a comma list, so one entry covers every alias. */
export function parseExemptEmails(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => normalizeEmail(e))
      .filter((e): e is string => e != null),
  );
}

/** Exempt when the domain is listed, or the mailbox (any +tag / Gmail-dot alias) is. */
export function isExemptEmail(
  email: string | null | undefined,
  domains: ReadonlySet<string>,
  emails: ReadonlySet<string>,
): boolean {
  const domain = emailDomain(email);
  if (domain != null && domains.has(domain)) return true;
  const mailbox = normalizeEmail(email);
  return mailbox != null && emails.has(mailbox);
}

export function parseExemptDomains(raw: string | undefined): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  );
}
