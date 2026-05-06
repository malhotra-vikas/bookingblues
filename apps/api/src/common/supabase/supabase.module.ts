import { Module } from '@nestjs/common';

import { ConfigModule } from '../../config/config.module';

import { SupabaseService } from './supabase.service';

@Module({
  imports: [ConfigModule],
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
