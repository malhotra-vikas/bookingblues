import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';

import { ConversationsService } from './conversations.service';

@Module({
  imports: [SupabaseModule],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
