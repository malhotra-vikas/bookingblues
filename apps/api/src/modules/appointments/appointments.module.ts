import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { EmailModule } from '../../common/email/email.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { CalendarModule } from '../calendar/calendar.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PaymentsModule } from '../payments/payments.module';

import { BookingHoldsController } from './booking-holds.controller';
import { BookingsService } from './bookings.service';
import { CalShortLinkController } from './cal-shortlink.controller';
import { IcsController } from './ics.controller';

@Module({
  imports: [
    SupabaseModule,
    CalendarModule,
    TwilioModule,
    ConversationsModule,
    AuditModule,
    PaymentsModule,
    EmailModule,
  ],
  controllers: [IcsController, BookingHoldsController, CalShortLinkController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class AppointmentsModule {}
