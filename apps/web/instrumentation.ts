// Next.js server/edge instrumentation hook. Loads the runtime-appropriate
// Sentry config; both are no-ops without SENTRY_DSN_WEB.
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captures errors thrown in nested React Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError;
