import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';

import { AuthModule } from '../../src/common/auth/auth.module';
import { ProblemDetailsFilter } from '../../src/common/filters/problem-details.filter';
import { LoggerModule } from '../../src/common/logger/logger.module';
import { SupabaseModule } from '../../src/common/supabase/supabase.module';
import { ConfigModule } from '../../src/config/config.module';
import { MeModule } from '../../src/modules/me/me.module';
import { OperatorsModule } from '../../src/modules/operators/operators.module';

/**
 * Boots a minimal Nest app for integration tests. Uses the same global filter
 * and `/v1` prefix as production.
 */
export async function buildTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      LoggerModule,
      SupabaseModule,
      AuthModule,
      MeModule,
      OperatorsModule,
    ],
    providers: [
      {
        provide: APP_FILTER,
        useFactory: (logger: PinoLogger): ProblemDetailsFilter =>
          new ProblemDetailsFilter(logger),
        inject: [PinoLogger],
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  app.setGlobalPrefix('v1');
  await app.init();
  return app;
}
