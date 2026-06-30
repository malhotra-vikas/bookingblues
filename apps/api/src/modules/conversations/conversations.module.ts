import { Module } from '@nestjs/common';

import { OpenAIModule } from '../../common/openai/openai.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';

import { ConversationsMaintenanceController } from './conversations-maintenance.controller';
import { ConversationsService } from './conversations.service';
import { EmergencyClassifierService } from './emergency-classifier.service';

@Module({
  imports: [SupabaseModule, OpenAIModule],
  controllers: [ConversationsMaintenanceController],
  providers: [ConversationsService, EmergencyClassifierService],
  exports: [ConversationsService, EmergencyClassifierService],
})
export class ConversationsModule {}
