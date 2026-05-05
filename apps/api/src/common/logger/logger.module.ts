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
            ignore: (req) => req.url === '/v1/health',
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
