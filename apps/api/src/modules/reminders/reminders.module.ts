import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { ConversationsModule } from '../conversations/conversations.module';

import { AppointmentRemindersController } from './appointment-reminders.controller';
import { AppointmentRemindersService } from './appointment-reminders.service';

@Module({
  imports: [SupabaseModule, TwilioModule, ConversationsModule],
  controllers: [AppointmentRemindersController],
  providers: [AppointmentRemindersService],
})
export class RemindersModule {}
