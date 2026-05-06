import { Module } from '@nestjs/common';

import { SupabaseModule } from '../../common/supabase/supabase.module';

import { OperatorsController } from './operators.controller';
import { OperatorsService } from './operators.service';

@Module({
  imports: [SupabaseModule],
  controllers: [OperatorsController],
  providers: [OperatorsService],
  exports: [OperatorsService],
})
export class OperatorsModule {}
