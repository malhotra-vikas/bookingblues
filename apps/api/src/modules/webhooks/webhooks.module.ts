import { Module } from '@nestjs/common';

import { StripeModule } from '../../common/stripe/stripe.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { WebhooksModule as IdempotencyWebhooksModule } from '../../common/webhooks/webhooks.module';
import { AiModule } from '../ai/ai.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { BillingModule } from '../billing/billing.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SlackModule } from '../slack/slack.module';
import { UsageModule } from '../usage/usage.module';
import { VoiceModule } from '../voice/voice.module';

import { StripeConnectController } from './stripe-connect.controller';
import { StripeEventProcessor } from './stripe-event-processor.service';
import { StripePlatformController } from './stripe-platform.controller';
import { TwilioSmsController } from './twilio-sms.controller';
import { TwilioStatusController } from './twilio-status.controller';
import { TwilioVoiceController } from './twilio-voice.controller';
import { WebhookReplayController } from './webhook-replay.controller';
import { WebhookReplayService } from './webhook-replay.service';

@Module({
  imports: [
    StripeModule,
    SupabaseModule,
    TwilioModule,
    IdempotencyWebhooksModule,
    ConversationsModule,
    AiModule,
    AppointmentsModule,
    BillingModule,
    SlackModule,
    UsageModule,
    VoiceModule,
  ],
  controllers: [
    StripePlatformController,
    StripeConnectController,
    TwilioVoiceController,
    TwilioSmsController,
    TwilioStatusController,
    WebhookReplayController,
  ],
  providers: [StripeEventProcessor, WebhookReplayService],
})
export class WebhooksModule {}
