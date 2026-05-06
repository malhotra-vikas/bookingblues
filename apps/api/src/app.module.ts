import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

import { AuthModule } from './common/auth/auth.module';
import { EncryptionModule } from './common/crypto/encryption.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { LoggerModule } from './common/logger/logger.module';
import { SupabaseModule } from './common/supabase/supabase.module';
import { WebhooksModule } from './common/webhooks/webhooks.module';
import { ConfigModule } from './config/config.module';
import { HealthController } from './modules/health/health.controller';
import { MeModule } from './modules/me/me.module';
import { OperatorsModule } from './modules/operators/operators.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    EncryptionModule,
    SupabaseModule,
    AuthModule,
    WebhooksModule,
    MeModule,
    OperatorsModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (logger: PinoLogger): ProblemDetailsFilter =>
        new ProblemDetailsFilter(logger),
      inject: [PinoLogger],
    },
  ],
})
export class AppModule {}
