// Browser Sentry init (Next.js client instrumentation). The DSN must be public
// to reach the browser bundle, so it reads NEXT_PUBLIC_SENTRY_DSN_WEB
// (referenced directly so Turbopack inlines it). No-op when unset.
import * as Sentry from '@sentry/nextjs';

import { scrubEvent } from './lib/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_WEB;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}

// Instruments client-side navigations for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
