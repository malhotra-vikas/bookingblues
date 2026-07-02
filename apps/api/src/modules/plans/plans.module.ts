import { Module } from '@nestjs/common';

import { StripeModule } from '../../common/stripe/stripe.module';

import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [StripeModule],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
