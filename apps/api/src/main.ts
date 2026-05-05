import 'reflect-metadata';

import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

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
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');

  const env = app.get<Env>(ENV_TOKEN);
  await app.listen(env.PORT, '0.0.0.0');

  app.get(Logger).log(
    { event: 'startup', port: env.PORT, env: env.NODE_ENV },
    `[api] listening on :${env.PORT}`,
  );
}

void bootstrap();
