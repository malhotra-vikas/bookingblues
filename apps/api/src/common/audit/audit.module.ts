import { Global, Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';

import { AuditLogService } from './audit-log.service';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
