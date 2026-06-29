import { Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { BookingsService } from './bookings.service';

/**
 * Internal cron endpoint that releases reserved-but-unpaid booking holds past
 * their TTL (Reserve→Pay→Confirm). Same pattern + auth as the reminders cron:
 * protected by `CRON_SHARED_SECRET` via the `X-Cron-Secret` header, skip-
 * throttled so retries pass. Idempotent (only acts on still-`proposed` rows),
 * so a tight cadence is safe — run every ~5 min.
 */
@Controller('internal/booking-holds')
@SkipThrottle()
export class BookingHoldsController {
  constructor(
    private readonly bookings: BookingsService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Post('release')
  @HttpCode(200)
  async release(@Req() req: Request): Promise<{ released: number }> {
    const expected = this.env.CRON_SHARED_SECRET;
    if (!expected) {
      throw new ForbiddenException('CRON_SHARED_SECRET not configured');
    }
    if ((req.header('x-cron-secret') ?? '') !== expected) {
      throw new ForbiddenException('bad cron secret');
    }
    return this.bookings.releaseExpiredHolds();
  }
}
