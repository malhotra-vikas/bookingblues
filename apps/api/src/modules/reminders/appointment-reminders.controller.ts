import { Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { AppointmentRemindersService } from './appointment-reminders.service';

/**
 * Internal cron endpoint for 1-hour-before appointment reminders. Same pattern
 * as the daily-summaries cron: protected by `CRON_SHARED_SECRET` via the
 * `X-Cron-Secret` header. Wire into Railway cron (or any scheduler) to run
 * every ~15 min — the service is idempotent (`reminder_sent_at`) so a tighter
 * cadence or a retry burst won't double-send.
 *
 * Skip-throttled because cron retries should pass through.
 */
@Controller('internal/appointment-reminders')
@SkipThrottle()
export class AppointmentRemindersController {
  constructor(
    private readonly reminders: AppointmentRemindersService,
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
    if (got !== expected) {
      throw new ForbiddenException('bad cron secret');
    }
    return this.reminders.runDue();
  }
}
