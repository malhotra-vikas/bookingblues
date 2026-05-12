import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import type {
  CandidatesResponse,
  ProvisionNumber,
  ProvisionNumberResponse,
} from './twilio-provisioning.dto';
import { CandidatesQuerySchema, ProvisionNumberSchema } from './twilio-provisioning.dto';
import { TwilioProvisioningService } from './twilio-provisioning.service';

@Controller('operators/me/twilio-number')
@UseGuards(AuthGuard)
export class TwilioProvisioningController {
  constructor(private readonly service: TwilioProvisioningService) {}

  /**
   * Vanity-biased candidate list for the wizard's "pick a number" step. UX:
   * the operator sees 3-4 options, vanity hits highlighted, picks one and
   * POSTs that exact number to `provision`. The "Just pick one for me"
   * button on the UI calls POST without phone_number_e164 — server auto-picks.
   */
  @Get('candidates')
  async candidates(
    @CurrentUser() user: AuthenticatedUser,
    @Query() rawQuery: Record<string, string>,
  ): Promise<CandidatesResponse> {
    const q = CandidatesQuerySchema.parse(rawQuery);
    const candidates = await this.service.findCandidates({
      userId: user.userId,
      ...(q.area_code ? { areaCode: q.area_code } : {}),
      ...(q.limit ? { limit: q.limit } : {}),
    });
    return { candidates };
  }

  @Post()
  async provision(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBodyPipe(ProvisionNumberSchema)) body: ProvisionNumber,
  ): Promise<ProvisionNumberResponse> {
    return this.service.provision(user.userId, {
      ...(body.area_code ? { areaCode: body.area_code } : {}),
      ...(body.phone_number_e164 ? { phoneNumberE164: body.phone_number_e164 } : {}),
    });
  }

  @Delete()
  async release(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ released_number: string }> {
    return this.service.release(user.userId);
  }
}
