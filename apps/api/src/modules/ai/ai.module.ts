import { Module } from '@nestjs/common';

import { OpenAIModule } from '../../common/openai/openai.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PaymentsModule } from '../payments/payments.module';
import { SlackModule } from '../slack/slack.module';

import { AdvanceSchedulerService } from './advance-scheduler.service';
import { AdvanceService } from './advance.service';

@Module({
  imports: [
    SupabaseModule,
    OpenAIModule,
    TwilioModule,
    CalendarModule,
    ConversationsModule,
    PaymentsModule,
    SlackModule,
    AppointmentsModule,
  ],
  providers: [AdvanceService, AdvanceSchedulerService],
  exports: [AdvanceService, AdvanceSchedulerService],
})
export class AiModule {}
