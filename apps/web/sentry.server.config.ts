// Server-runtime Sentry init (imported by instrumentation.ts on the Node
// runtime). No-op without SENTRY_DSN_WEB. PII scrubbed via beforeSend.
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from './lib/sentry-scrub';

const dsn = process.env.SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}
