import { Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { DailySummariesService } from './daily-summaries.service';

/**
 * Internal cron endpoint. Protected by a shared secret (`CRON_SHARED_SECRET`)
 * — caller sends `X-Cron-Secret: <value>`. Wired into Railway cron (or any
 * external scheduler) at e.g. 09:00 UTC daily.
 *
 * Skip-throttled because a single cron-side retry burst should be allowed
 * through (the service itself is idempotent).
 */
@Controller('internal/daily-summaries')
@SkipThrottle()
export class SummariesController {
  constructor(
    private readonly daily: DailySummariesService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Post('run')
  @HttpCode(200)
  async run(@Req() req: Request): Promise<unknown> {
    const expected = this.env.CRON_SHARED_SECRET;
    if (!expected) {
      throw new ForbiddenException('CRON_SHARED_SECRET not configured');
    }
    const got = req.header('x-cron-secret') ?? '';
    // Constant-time-ish compare. The strings are short and the secret is
    // not user-supplied — exact equality is fine in practice.
    if (got !== expected) {
      throw new ForbiddenException('bad cron secret');
    }
    return this.daily.runForYesterday();
  }
}
