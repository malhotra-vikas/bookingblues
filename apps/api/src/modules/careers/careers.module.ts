import { Module } from '@nestjs/common';

import { CareersController } from './careers.controller';

/** EmailService is provided by the @Global() EmailModule, so no imports needed. */
@Module({
  controllers: [CareersController],
})
export class CareersModule {}
