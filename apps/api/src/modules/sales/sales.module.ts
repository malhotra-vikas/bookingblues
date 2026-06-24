import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';

import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

// AuthModule (SalesGuard) and AuditModule (AuditLogService) are @Global; only
// SupabaseModule needs importing here.
@Module({
  imports: [SupabaseModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
