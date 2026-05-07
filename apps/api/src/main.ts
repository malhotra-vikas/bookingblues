import 'reflect-metadata';

import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';

// Load .env.local from the monorepo root before anything reads process.env.
// In production we rely on the platform (Railway) to inject env directly; dotenv
// is a noop when files are absent.
loadDotenv({ path: resolve(__dirname, '../../../.env.local') });
loadDotenv({ path: resolve(__dirname, '../../../.env') });

// eslint-disable-next-line import/order
import { AppModule } from './app.module';
import { ENV_TOKEN } from './config/config.module';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  // `rawBody: true` exposes `req.rawBody` for Stripe/Twilio signature verification
  // (CLAUDE.md §11.1) while still parsing JSON for the rest of the app.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(Logger));

  // Strip the `X-Powered-By: Express` header — small information-disclosure win.
  app.disable('x-powered-by');

  // Security headers (CLAUDE.md §11.20). HSTS preload kicks in only over HTTPS;
  // browsers ignore on http://localhost. CSP off — this is a JSON API, no HTML.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: {
        maxAge: 63072000, // 2 years — required for the HSTS preload list
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      frameguard: { action: 'deny' },
    }),
  );

  const env = app.get<Env>(ENV_TOKEN);

  // CORS: only the configured Web origin (CLAUDE.md §11.6). No `*`.
  app.enableCors({
    origin: env.APP_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type'],
  });

  // Per CLAUDE.md §10, webhook routes are unprefixed (Twilio/Stripe/Google call
  // them directly). Everything else lives under /v1.
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'webhooks/(.*)', method: RequestMethod.ALL }],
  });

  await app.listen(env.PORT, '0.0.0.0');

  app.get(Logger).log(
    { event: 'startup', port: env.PORT, env: env.NODE_ENV },
    `[api] listening on :${env.PORT}`,
  );
}

void bootstrap();
