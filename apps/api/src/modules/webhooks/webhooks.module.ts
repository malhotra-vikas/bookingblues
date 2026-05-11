import { Module } from '@nestjs/common';

import { StripeModule } from '../../common/stripe/stripe.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { WebhooksModule as IdempotencyWebhooksModule } from '../../common/webhooks/webhooks.module';
import { AiModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SlackModule } from '../slack/slack.module';

import { StripeConnectController } from './stripe-connect.controller';
import { StripePlatformController } from './stripe-platform.controller';
import { TwilioSmsController } from './twilio-sms.controller';
import { TwilioVoiceController } from './twilio-voice.controller';

@Module({
  imports: [
    StripeModule,
    SupabaseModule,
    TwilioModule,
    IdempotencyWebhooksModule,
    ConversationsModule,
    AiModule,
    SlackModule,
  ],
  controllers: [
    StripePlatformController,
    StripeConnectController,
    TwilioVoiceController,
    TwilioSmsController,
  ],
})
export class WebhooksModule {}
