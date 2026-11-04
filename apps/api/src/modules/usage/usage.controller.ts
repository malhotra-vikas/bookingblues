import { Controller, ForbiddenException, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { type ReconcileResult, UsageBillingService } from './usage-billing.service';

/**
 * Internal cron: bills every closed, unbilled Crew/Fleet usage window (annual
 * plans, plus any monthly window the renewal invoice missed). Same auth as the
 * other crons (`X-Cron-Secret`). Idempotent — run daily.
 */
@Controller('internal/usage')
@SkipThrottle()
export class UsageController {
  constructor(
    private readonly billing: UsageBillingService,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {}

  // `close-annual-windows` is the original name, kept so an existing cron keeps working.
  @Post(['reconcile-overage', 'close-annual-windows'])
  @HttpCode(200)
  async reconcileOverage(@Req() req: Request): Promise<ReconcileResult> {
    const expected = this.env.CRON_SHARED_SECRET;
    if (!expected) throw new ForbiddenException('CRON_SHARED_SECRET not configured');
    if ((req.header('x-cron-secret') ?? '') !== expected) throw new ForbiddenException('bad cron secret');
    return this.billing.reconcileOverage();
  }
}
