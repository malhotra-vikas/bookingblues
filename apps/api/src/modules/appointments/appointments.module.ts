import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ConversationsModule } from '../conversations/conversations.module';

import { BookingsService } from './bookings.service';
import { IcsController } from './ics.controller';

@Module({
  imports: [SupabaseModule, CalendarModule, TwilioModule, ConversationsModule, AuditModule],
  controllers: [IcsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class AppointmentsModule {}
