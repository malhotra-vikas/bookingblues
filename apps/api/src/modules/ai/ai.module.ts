import { Module } from '@nestjs/common';

import { OpenAIModule } from '../../common/openai/openai.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PaymentsModule } from '../payments/payments.module';

import { AdvanceService } from './advance.service';

@Module({
  imports: [
    SupabaseModule,
    OpenAIModule,
    TwilioModule,
    CalendarModule,
    ConversationsModule,
    PaymentsModule,
  ],
  providers: [AdvanceService],
  exports: [AdvanceService],
})
export class AiModule {}
