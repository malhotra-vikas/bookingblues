import { Global, Module } from '@nestjs/common';

import type { Env } from './env';
import { loadEnv } from './env';

export const ENV_TOKEN = Symbol.for('bookingblues.env');

@Global()
@Module({
  providers: [
    {
      provide: ENV_TOKEN,
      useFactory: (): Env => loadEnv(),
    },
  ],
  exports: [ENV_TOKEN],
})
export class ConfigModule {}
