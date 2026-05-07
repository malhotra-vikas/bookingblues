import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import type {
  CheckoutSessionResponse,
  CreateCheckoutSession,
  PortalSessionResponse,
} from './billing.dto';
import { CreateCheckoutSessionSchema } from './billing.dto';
import { BillingService } from './billing.service';

@Controller('billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Post('checkout-session')
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBodyPipe(CreateCheckoutSessionSchema)) body: CreateCheckoutSession,
  ): Promise<CheckoutSessionResponse> {
    return this.service.createCheckoutSession(user.userId, user.email, body.plan, body.business_name);
  }

  @Get('portal-session')
  async portal(@CurrentUser() user: AuthenticatedUser): Promise<PortalSessionResponse> {
    return this.service.createPortalSession(user.userId);
  }

  @Post('end-trial')
  async endTrial(@CurrentUser() user: AuthenticatedUser): Promise<{ ok: true }> {
    await this.service.endTrialNow(user.userId);
    return { ok: true };
  }
}
