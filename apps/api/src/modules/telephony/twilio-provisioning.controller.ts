import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import type { ProvisionNumber, ProvisionNumberResponse } from './twilio-provisioning.dto';
import { ProvisionNumberSchema } from './twilio-provisioning.dto';
import { TwilioProvisioningService } from './twilio-provisioning.service';

@Controller('operators/me/twilio-number')
@UseGuards(AuthGuard)
export class TwilioProvisioningController {
  constructor(private readonly service: TwilioProvisioningService) {}

  @Post()
  async provision(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBodyPipe(ProvisionNumberSchema)) body: ProvisionNumber,
  ): Promise<ProvisionNumberResponse> {
    return this.service.provision(user.userId, body.area_code);
  }

  @Delete()
  async release(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ released_number: string }> {
    return this.service.release(user.userId);
  }
}
