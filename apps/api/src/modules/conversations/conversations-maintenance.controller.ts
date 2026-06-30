import { Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { ConversationsService } from './conversations.service';

/**
 * Internal cron endpoint that auto-closes idle conversations (so the
 * post-booking `awaiting_caller` state doesn't leave stale open threads).
 * Same pattern + auth as the reminders / booking-holds crons: `CRON_SHARED_SECRET`
 * via `X-Cron-Secret`, skip-throttled, idempotent. Run hourly.
 */
@Controller('internal/conversations')
@SkipThrottle()
export class ConversationsMaintenanceController {
  constructor(
    private readonly conversations: ConversationsService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Post('close-stale')
  @HttpCode(200)
  async closeStale(@Req() req: Request): Promise<{ closed: number }> {
    const expected = this.env.CRON_SHARED_SECRET;
    if (!expected) {
      throw new ForbiddenException('CRON_SHARED_SECRET not configured');
    }
    if ((req.header('x-cron-secret') ?? '') !== expected) {
      throw new ForbiddenException('bad cron secret');
    }
    return this.conversations.closeStale();
  }
}
