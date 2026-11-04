import { Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { type ReplayResult, WebhookReplayService } from './webhook-replay.service';

/**
 * Internal cron: re-runs Stripe webhook events that failed or were abandoned
 * mid-processing. Same auth as the other crons (`X-Cron-Secret`). Claim-guarded
 * and idempotent — run every 10 minutes.
 */
@Controller('internal/webhooks')
@SkipThrottle()
export class WebhookReplayController {
  constructor(
    private readonly replay: WebhookReplayService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Post('replay')
  @HttpCode(200)
  async replayFailed(@Req() req: Request): Promise<ReplayResult> {
    const expected = this.env.CRON_SHARED_SECRET;
    if (!expected) throw new ForbiddenException('CRON_SHARED_SECRET not configured');
    if ((req.header('x-cron-secret') ?? '') !== expected) throw new ForbiddenException('bad cron secret');
    return this.replay.replayUnprocessed();
  }
}
