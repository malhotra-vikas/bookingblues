import { Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { UsageBillingService } from './usage-billing.service';

/**
 * Internal cron: bills annual Crew/Fleet overage for each closed monthly window.
 * Same auth as the other crons (`X-Cron-Secret`). Idempotent — run daily.
 */
@Controller('internal/usage')
@SkipThrottle()
export class UsageController {
  constructor(
    private readonly billing: UsageBillingService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  @Post('close-annual-windows')
  @HttpCode(200)
  async closeAnnualWindows(@Req() req: Request): Promise<{ checked: number; billed: number }> {
    const expected = this.env.CRON_SHARED_SECRET;
    if (!expected) throw new ForbiddenException('CRON_SHARED_SECRET not configured');
    if ((req.header('x-cron-secret') ?? '') !== expected) throw new ForbiddenException('bad cron secret');
    return this.billing.closeAnnualWindows();
  }
}
