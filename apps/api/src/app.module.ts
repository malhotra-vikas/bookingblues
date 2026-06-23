import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';

import { AuditModule } from './common/audit/audit.module';
import { AuthModule } from './common/auth/auth.module';
import { EncryptionModule } from './common/crypto/encryption.module';
import { EmailModule } from './common/email/email.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { LoggerModule } from './common/logger/logger.module';
import { OpenAIModule } from './common/openai/openai.module';
import { StripeModule } from './common/stripe/stripe.module';
import { SupabaseModule } from './common/supabase/supabase.module';
import { TwilioModule } from './common/twilio/twilio.module';
import { WebhooksModule as IdempotencyWebhooksModule } from './common/webhooks/webhooks.module';
import { ConfigModule } from './config/config.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { BillingModule } from './modules/billing/billing.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ConsentModule } from './modules/consent/consent.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { HealthController } from './modules/health/health.controller';
import { LeadsModule } from './modules/leads/leads.module';
import { MeModule } from './modules/me/me.module';
import { OperatorsModule } from './modules/operators/operators.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { SlackModule } from './modules/slack/slack.module';
import { SummariesModule } from './modules/summaries/summaries.module';
import { TelephonyModule } from './modules/telephony/telephony.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    // Per CLAUDE.md §11.7: 60 req/min default per IP, stricter on auth.
    // Webhook controllers opt out via @SkipThrottle() — Stripe/Twilio retry
    // loops would otherwise trip the limiter and break delivery.
    // 60 req/min/IP globally (CLAUDE.md §11.7). Auth-mutating routes override
    // with a stricter limit via `@Throttle({ default: { ttl, limit } })` —
    // single named throttler keeps the math simple (one bucket per IP).
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
    }),
    EncryptionModule,
    SupabaseModule,
    AuditModule,
    EmailModule,
    StripeModule,
    TwilioModule,
    OpenAIModule,
    AuthModule,
    IdempotencyWebhooksModule,
    MeModule,
    OperatorsModule,
    BillingModule,
    ConversationsModule,
    TelephonyModule,
    CalendarModule,
    PaymentsModule,
    DashboardModule,
    AppointmentsModule,
    AiModule,
    AdminModule,
    SlackModule,
    LeadsModule,
    ConsentModule,
    SummariesModule,
    RemindersModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (logger: PinoLogger): ProblemDetailsFilter =>
        new ProblemDetailsFilter(logger),
      inject: [PinoLogger],
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
