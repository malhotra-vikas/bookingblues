import { Module } from '@nestjs/common';

import { EncryptionModule } from '../../common/crypto/encryption.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';

import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { GoogleOAuthService } from './google-oauth.service';

@Module({
  imports: [SupabaseModule, EncryptionModule],
  controllers: [CalendarController],
  providers: [CalendarService, GoogleOAuthService],
  exports: [CalendarService],
})
export class CalendarModule {}
