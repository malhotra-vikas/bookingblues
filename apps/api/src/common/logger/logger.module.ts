import { Inject, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Params } from 'nestjs-pino';

import { ConfigModule, ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Per CLAUDE.md §11.5: redact PII before any log line is emitted.
 * Pino's `redact` runs before serialization — it cannot be bypassed by call-site mistakes.
 */
const REDACT_PATHS = [
  // Twilio webhook fields
  'req.body.From',
  'req.body.To',
  'req.body.Body',
  'req.body.from',
  'req.body.to',
  'req.body.body',
  // Generic PII
  '*.phone',
  '*.email',
  '*.refresh_token',
  '*.access_token',
  // Auth headers
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-twilio-signature"]',
  'req.headers["stripe-signature"]',
  'req.headers["x-slack-signature"]',
  // Slack tokens (Slice 7.5)
  '*.bot_token',
  '*.encrypted_bot_token',
  '*.slack_token',
];

@Module({
  imports: [
    ConfigModule,
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV_TOKEN],
      useFactory: (env: Env): Params => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
          // Pretty-print only in dev. Prod stays JSON for log shippers.
          ...(env.NODE_ENV === 'development'
            ? {
                transport: {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
                },
              }
            : {}),
          autoLogging: {
            // Skip noisy infra-level requests. Dashboard polling and the
            // health check shouldn't be in the log feed; we still log the
            // interesting webhooks + admin actions + errors.
            ignore: (req) => {
              const url = req.url ?? '';
              if (url === '/v1/health') return true;
              if (url.startsWith('/v1/dashboard/metrics')) return true;
              if (url.startsWith('/v1/conversations')) return true;
              if (url.startsWith('/v1/appointments')) return true;
              if (url.startsWith('/v1/operators/me')) return true;
              if (url.startsWith('/v1/admin/metrics')) return true;
              if (url.startsWith('/v1/admin/operators')) return true;
              if (url.startsWith('/v1/admin/leads')) return true;
              return false;
            },
          },
          // Trim the per-request payload. Default pino-http dumps every
          // header + every response header; the resulting JSON is ~3KB per
          // line. Keep only what we actually need to debug.
          serializers: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            req: (req: any) => ({
              method: req.method,
              url: req.url,
              id: req.id,
            }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            res: (res: any) => ({ statusCode: res.statusCode }),
          },
          // Drop the "request completed"/"request errored" boilerplate; the
          // (method, url, status, responseTime) tuple is the useful bit.
          customSuccessMessage: (req, res, responseTime) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            `${(req as any).method} ${(req as any).url} ${(res as any).statusCode} ${responseTime}ms`,
          customErrorMessage: (req, res, err) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            `${(req as any).method} ${(req as any).url} ${(res as any).statusCode} — ${err.message}`,
          // Demote routine 2xx/3xx to debug so they're hidden at level=info
          // in prod. 4xx → warn, 5xx → error. Tweak LOG_LEVEL=debug in
          // Railway env to see everything again.
          customLogLevel: (_req, res, err) => {
            if (err || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'debug';
          },
          customProps: () => ({ service: 'api' }),
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {
  // Force ENV_TOKEN to be resolved before bootstrap so misconfig fails fast,
  // even if no other provider injects it.
  constructor(@Inject(ENV_TOKEN) _env: Env) {}
}
