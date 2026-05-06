import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';

import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [SupabaseModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
