import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { WebhooksModule as IdempotencyWebhooksModule } from '../../common/webhooks/webhooks.module';
import { ConversationsModule } from '../conversations/conversations.module';

import { EscalationsService } from './escalations.service';
import { SlackApiClient } from './slack-api.client';
import { SlackSignatureGuard } from './slack-signature.guard';
import { SlackWebhooksController } from './slack-webhooks.controller';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    SupabaseModule,
    TwilioModule,
    IdempotencyWebhooksModule,
    ConversationsModule,
  ],
  controllers: [SlackWebhooksController],
  providers: [SlackApiClient, EscalationsService, SlackSignatureGuard],
  exports: [EscalationsService],
})
export class SlackModule {}
