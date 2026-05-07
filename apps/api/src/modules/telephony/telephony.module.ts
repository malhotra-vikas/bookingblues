import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';

import { TwilioProvisioningController } from './twilio-provisioning.controller';
import { TwilioProvisioningService } from './twilio-provisioning.service';

@Module({
  imports: [TwilioModule, SupabaseModule],
  controllers: [TwilioProvisioningController],
  providers: [TwilioProvisioningService],
  exports: [TwilioProvisioningService],
})
export class TelephonyModule {}
