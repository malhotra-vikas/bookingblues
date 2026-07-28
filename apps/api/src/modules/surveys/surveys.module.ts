import { Module } from '@nestjs/common';

import { SurveysController } from './surveys.controller';

/** EmailService is provided by the @Global() EmailModule, so no imports needed. */
@Module({
  controllers: [SurveysController],
})
export class SurveysModule {}
