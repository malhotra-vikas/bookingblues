import { Module } from '@nestjs/common';

import { StripeModule } from '../../common/stripe/stripe.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';

import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { TrialGuardService } from './trial-guard.service';

@Module({
  imports: [StripeModule, SupabaseModule],
  controllers: [BillingController],
  providers: [BillingService, TrialGuardService],
  exports: [BillingService, TrialGuardService],
})
export class BillingModule {}
