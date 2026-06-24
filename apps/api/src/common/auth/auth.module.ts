import { Global, Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';

import { AdminGuard } from './admin.guard';
import { AuthGuard } from './auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';
import { SalesGuard } from './sales.guard';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [JwtVerifierService, AuthGuard, AdminGuard, SalesGuard],
  exports: [JwtVerifierService, AuthGuard, AdminGuard, SalesGuard],
})
export class AuthModule {}
