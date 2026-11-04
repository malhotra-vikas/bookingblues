import { Module } from '@nestjs/common';

import { StripeModule } from '../../common/stripe/stripe.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';

import { UsageBillingService } from './usage-billing.service';
import { UsageController } from './usage.controller';
import { UsageNotifierService } from './usage-notifier.service';
import { UsageService } from './usage.service';

/** Plan usage metering, limit enforcement, alerts and overage billing (#usage-metering). */
@Module({
  imports: [SupabaseModule, StripeModule],
  controllers: [UsageController],
  providers: [UsageService, UsageNotifierService, UsageBillingService],
  exports: [UsageService, UsageBillingService],
})
export class UsageModule {}
