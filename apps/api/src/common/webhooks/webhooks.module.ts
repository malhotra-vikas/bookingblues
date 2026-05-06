import { Module } from '@nestjs/common';

import { SupabaseModule } from '../supabase/supabase.module';

import { WebhookIdempotencyService } from './webhook-idempotency.service';

@Module({
  imports: [SupabaseModule],
  providers: [WebhookIdempotencyService],
  exports: [WebhookIdempotencyService],
})
export class WebhooksModule {}
