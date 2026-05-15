import { Module } from '@nestjs/common';

import { OpenAIModule } from '../../common/openai/openai.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';

import { ConversationsService } from './conversations.service';
import { EmergencyClassifierService } from './emergency-classifier.service';

@Module({
  imports: [SupabaseModule, OpenAIModule],
  providers: [ConversationsService, EmergencyClassifierService],
  exports: [ConversationsService, EmergencyClassifierService],
})
export class ConversationsModule {}
