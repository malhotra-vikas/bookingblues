import { Global, Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';

import { AuthGuard } from './auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';

@Global()
@Module({
  imports: [SupabaseModule],
  providers: [JwtVerifierService, AuthGuard],
  exports: [JwtVerifierService, AuthGuard],
})
export class AuthModule {}
