import { Global, Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';

import { AdminGuard } from './admin.guard';
import { AuthGuard } from './auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [JwtVerifierService, AuthGuard, AdminGuard],
  exports: [JwtVerifierService, AuthGuard, AdminGuard],
})
export class AuthModule {}
