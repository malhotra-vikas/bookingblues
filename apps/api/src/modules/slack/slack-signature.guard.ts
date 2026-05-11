import { createHmac, timingSafeEqual } from 'node:crypto';

import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { AppError, WebhookSignatureError } from '../../common/errors/app-error';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Slack signs every webhook delivery with a v0 HMAC over
 * `v0:<timestamp>:<rawBody>` using the App's Signing Secret.
 *
 * Spec: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Rejects:
 *   - Missing or malformed signature/timestamp headers
 *   - Timestamps older than 5 minutes (replay-attack window)
 *   - HMACs that don't match the computed value (constant-time compare)
 */
const FIVE_MINUTES_MS = 5 * 60 * 1000;

type RawBodyRequest = Request & { rawBody?: Buffer };

@Injectable()
export class SlackSignatureGuard implements CanActivate {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SlackSignatureGuard.name);
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.env.SLACK_SIGNING_SECRET) {
      throw new AppError({
        code: 'slack.no_signing_secret',
        status: 500,
        detail: 'SLACK_SIGNING_SECRET is not configured',
      });
    }
    const req = ctx.switchToHttp().getRequest<RawBodyRequest>();
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];
    if (typeof signature !== 'string' || typeof timestamp !== 'string') {
      throw new WebhookSignatureError('slack');
    }

    // Replay guard.
    const tsMs = Number(timestamp) * 1000;
    if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > FIVE_MINUTES_MS) {
      throw new WebhookSignatureError('slack');
    }

    const raw = req.rawBody;
    if (!raw) {
      // rawBody is exposed by `NestFactory.create(... { rawBody: true })` in main.ts.
      // If it's missing, configuration is broken.
      throw new AppError({
        code: 'slack.no_raw_body',
        status: 500,
        detail: 'Slack signature verification requires raw body buffering',
      });
    }

    const base = `v0:${timestamp}:${raw.toString('utf8')}`;
    const mac = createHmac('sha256', this.env.SLACK_SIGNING_SECRET).update(base).digest('hex');
    const expected = `v0=${mac}`;

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn({ event: 'slack_bad_signature' }, 'Slack signature mismatch');
      throw new WebhookSignatureError('slack');
    }
    return true;
  }
}
