import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { SlackApiClient } from '../slack/slack-api.client';

import { LeadsController } from './leads.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [LeadsController],
  providers: [SlackApiClient],
})
export class LeadsModule {}
