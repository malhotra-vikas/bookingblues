import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { SlackModule } from '../slack/slack.module';

import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// AuthModule (SalesGuard) and AuditModule (AuditLogService) are @Global.
// SlackModule provides SlackApiClient for the #new-leads announcement.
@Module({
  imports: [SupabaseModule, SlackModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
