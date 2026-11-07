import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { AiModule } from '../ai/ai.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { SlackModule } from '../slack/slack.module';
import { UsageModule } from '../usage/usage.module';

import { VoiceCallService } from './voice-call.service';
import { VoiceStreamGateway } from './voice-stream.gateway';

/** Voice AI spike: live AI phone conversations over OpenAI Realtime. */
@Module({
  imports: [SupabaseModule, TwilioModule, AiModule, ConversationsModule, SlackModule, UsageModule],
  providers: [VoiceCallService, VoiceStreamGateway],
  exports: [VoiceCallService],
})
export class VoiceModule {}
