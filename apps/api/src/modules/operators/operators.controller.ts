import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import type { UpdateOperator } from './operators.dto';
import { UpdateOperatorSchema } from './operators.dto';
import type { OnboardingStatus, OperatorRow } from './operators.service';
import { OperatorsService } from './operators.service';

@Controller('operators/me')
@UseGuards(AuthGuard)
export class OperatorsController {
  constructor(private readonly service: OperatorsService) {}

  @Get()
  async getMe(@CurrentUser() user: AuthenticatedUser): Promise<OperatorRow> {
    return this.service.getByUserIdRequired(user.userId);
  }

  @Patch()
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBodyPipe(UpdateOperatorSchema)) body: UpdateOperator,
  ): Promise<OperatorRow> {
    return this.service.update(user.userId, body);
  }

  @Get('onboarding-status')
  async onboardingStatus(@CurrentUser() user: AuthenticatedUser): Promise<OnboardingStatus> {
    const op = await this.service.getByUserIdRequired(user.userId);
    return this.service.getOnboardingStatus(op);
  }
}
