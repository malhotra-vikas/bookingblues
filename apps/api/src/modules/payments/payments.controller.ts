import { Controller, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ConnectOnboardingService } from './connect-onboarding.service';

@Controller('operators/me/connect')
@UseGuards(AuthGuard)
export class PaymentsController {
  constructor(private readonly onboarding: ConnectOnboardingService) {}

  @Post('onboarding-link')
  async onboardingLink(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    return this.onboarding.createOnboardingLink(user.userId, user.email);
  }

  @Post('sync')
  async sync(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ charges_enabled: boolean; payouts_enabled: boolean; details_submitted: boolean }> {
    return this.onboarding.syncAccountStatus(user.userId);
  }
}
