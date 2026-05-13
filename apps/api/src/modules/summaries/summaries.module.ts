import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';

import { DailySummariesService } from './daily-summaries.service';
import { SummariesController } from './summaries.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [SummariesController],
  providers: [DailySummariesService],
})
export class SummariesModule {}
