import { Module } from '@nestjs/common';

import { AuthModule } from '../../common/auth/auth.module';
import { StripeModule } from '../../common/stripe/stripe.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { PaymentsModule } from '../payments/payments.module';
import { SlackApiClient } from '../slack/slack-api.client';

import { AdminReadController } from './admin-read.controller';
import { AdminReadService } from './admin-read.service';
import { AdminWriteController } from './admin-write.controller';
import { AdminWriteService } from './admin-write.service';

@Module({
  imports: [AuthModule, SupabaseModule, StripeModule, TwilioModule, PaymentsModule],
  controllers: [AdminReadController, AdminWriteController],
  providers: [AdminReadService, AdminWriteService, SlackApiClient],
  exports: [AdminReadService, AdminWriteService],
})
export class AdminModule {}
