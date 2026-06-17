/**
 * Recursive PII scrubber for Sentry events (CLAUDE.md §11.4–§11.5). Mirrors the
 * API's instrument.ts: redacts values under sensitive keys (phone, email,
 * Twilio From/To/Body, auth/cookie/signature headers, tokens, secrets) before
 * any event leaves the process. Used as `beforeSend` / `beforeSendTransaction`
 * in every Sentry init (client, server, edge).
 */
const SENSITIVE_KEY_EXACT = /^(authorization|cookie|password|refresh_token|access_token|from|to|body)$/i;
const SENSITIVE_KEY_SUBSTR = /(secret|token|password|passwd|phone|email|signature|api[-_]?key|credential)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_EXACT.test(key) || SENSITIVE_KEY_SUBSTR.test(key);
}

function scrubInPlace(node: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): void {
  if (depth > 8 || node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) scrubInPlace(item, seen, depth + 1);
    return;
  }

  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (isSensitiveKey(key)) {
      record[key] = '[redacted]';
    } else {
      scrubInPlace(record[key], seen, depth + 1);
    }
  }
}

export function scrubEvent<T>(event: T): T {
  scrubInPlace(event);
  return event;
}
