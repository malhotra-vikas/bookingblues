import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

import { EncryptionModule } from './common/crypto/encryption.module';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { LoggerModule } from './common/logger/logger.module';
import { ConfigModule } from './config/config.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [ConfigModule, LoggerModule, EncryptionModule],
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
