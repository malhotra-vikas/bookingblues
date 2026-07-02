import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { PlansService, type PlanPricing } from './plans.service';

/**
 * Public plan pricing, sourced live from Stripe (cached). The marketing/pricing
 * UI reads this so prices are never hardcoded — change a price in Stripe (or
 * repoint a STRIPE_PRICE_* env) and the site reflects it on the next cache
 * refresh. No auth: this is public catalog data.
 */
@Controller('plans')
@SkipThrottle()
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  async list(): Promise<{ plans: PlanPricing[] }> {
    return { plans: await this.plans.getPlans() };
  }
}
