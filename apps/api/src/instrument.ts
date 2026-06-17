/**
 * Sentry initialisation for the API. Imported FIRST in `main.ts` (before the
 * Nest app) so the SDK instruments the runtime early.
 *
 * No-op when `SENTRY_DSN_API` is unset — local dev and tests never send events.
 *
 * PII discipline (CLAUDE.md §11.4–§11.5): `sendDefaultPii: false` plus a
 * recursive scrubber on every outbound event/transaction that redacts keys
 * matching the same denylist as the Pino redaction config (phone, email,
 * Twilio From/To/Body, auth/cookie/signature headers, tokens, secrets). We never
 * ship message bodies or credentials to Sentry.
 */
import * as Sentry from '@sentry/node';

// Exact-match keys (Twilio webhook fields + standard auth) and substring matches
// (anything token/secret/credential/contact-shaped). Case-insensitive.
const SENSITIVE_KEY_EXACT = /^(authorization|cookie|password|refresh_token|access_token|from|to|body)$/i;
const SENSITIVE_KEY_SUBSTR = /(secret|token|password|passwd|phone|email|signature|api[-_]?key|credential)/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_EXACT.test(key) || SENSITIVE_KEY_SUBSTR.test(key);
}

/**
 * Mutates `node` in place, replacing values under sensitive keys with
 * `[redacted]`. Cycle- and depth-guarded so a pathological event can't hang the
 * `beforeSend` hook.
 */
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

const dsn = process.env.SENTRY_DSN_API;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Railway injects the deployed commit SHA; falls back to undefined (Sentry
    // then groups under "unknown release") rather than a fabricated value.
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    // Sample a slice of transactions in prod; none in dev/test.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    sendDefaultPii: false,
    beforeSend: (event) => {
      scrubInPlace(event);
      return event;
    },
    beforeSendTransaction: (event) => {
      scrubInPlace(event);
      return event;
    },
  });
}
