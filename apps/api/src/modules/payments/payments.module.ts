import { Module } from '@nestjs/common';

import { StripeModule } from '../../common/stripe/stripe.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';

import { ConnectOnboardingService } from './connect-onboarding.service';
import { PaymentRedirectController } from './payment-redirect.controller';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [StripeModule, SupabaseModule],
  controllers: [PaymentsController, PaymentRedirectController],
  providers: [PaymentsService, ConnectOnboardingService],
  exports: [PaymentsService, ConnectOnboardingService],
})
export class PaymentsModule {}
