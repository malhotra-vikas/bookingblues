import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';

import { SmsConsentController } from './sms-consent.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [SmsConsentController],
})
export class ConsentModule {}
