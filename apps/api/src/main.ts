import 'reflect-metadata';
// Sentry must initialise before the Nest app is created. No-op without a DSN.
import './instrument';

import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
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

  // Raise the JSON body limit above the 100kb default so the careers page can
  // POST a base64-encoded resume (capped ~5MB → ~6.7MB encoded + fields).
  // Works alongside `rawBody: true` (Nest re-parses; rawBody buffer preserved).
  app.useBodyParser('json', { limit: '8mb' });

  // Strip the `X-Powered-By: Express` header — small information-disclosure win.
  app.disable('x-powered-by');

  // Trust exactly ONE proxy hop (Railway's edge). Without this, Express derives
  // `req.ip` from the socket — which is Railway's internal proxy address, the
  // SAME for every external client — so the per-IP rate limiter (CLAUDE.md
  // §11.7) collapses into a single shared bucket and 429s everyone at once.
  // Trusting `1` (not `true`) means we read the client IP that Railway's proxy
  // recorded and a client cannot forge it by injecting its own X-Forwarded-For.
  // Locally (no proxy / no XFF) this harmlessly falls back to the socket IP.
  app.set('trust proxy', 1);

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

  // Permissions-Policy (CLAUDE.md §11.20). helmet doesn't set this. This is a
  // JSON API with no browser-feature needs, so deny the powerful features
  // outright — defense in depth if a response is ever rendered in a browser.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    );
    next();
  });

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
    exclude: [
      { path: 'webhooks/(.*)', method: RequestMethod.ALL },
      // Short, clean booking-fee payment links sent over SMS (no /v1, no special
      // chars) that 302 to the long Stripe Checkout URL.
      { path: 'pay/(.*)', method: RequestMethod.ALL },
      // Short "add to calendar" links (302 → the /v1/appointments/:id.ics ICS).
      { path: 'cal/(.*)', method: RequestMethod.ALL },
    ],
  });

  await app.listen(env.PORT, '0.0.0.0');

  app.get(Logger).log(
    { event: 'startup', port: env.PORT, env: env.NODE_ENV },
    `[api] listening on :${env.PORT}`,
  );
}

void bootstrap();
