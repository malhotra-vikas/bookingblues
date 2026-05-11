import { Module } from '@nestjs/common';

import { AuditModule } from '../../common/audit/audit.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EncryptionModule } from '../../common/crypto/encryption.module';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { TwilioModule } from '../../common/twilio/twilio.module';
import { WebhooksModule as IdempotencyWebhooksModule } from '../../common/webhooks/webhooks.module';
import { ConversationsModule } from '../conversations/conversations.module';

import { EscalationsService } from './escalations.service';
import { SlackApiClient } from './slack-api.client';
import { SlackConnectionsService } from './slack-connections.service';
import { SlackInstallController } from './slack-install.controller';
import { SlackSignatureGuard } from './slack-signature.guard';
import { SlackWebhooksController } from './slack-webhooks.controller';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    SupabaseModule,
    EncryptionModule,
    TwilioModule,
    IdempotencyWebhooksModule,
    ConversationsModule,
  ],
  controllers: [SlackInstallController, SlackWebhooksController],
  providers: [SlackApiClient, SlackConnectionsService, EscalationsService, SlackSignatureGuard],
  exports: [EscalationsService, SlackConnectionsService],
})
export class SlackModule {}
