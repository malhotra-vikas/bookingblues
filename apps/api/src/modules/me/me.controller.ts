import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import type { MeResponse, UpdateMe } from './me.dto';
import { UpdateMeSchema } from './me.dto';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly service: MeService) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    return this.service.get(user.userId);
  }

  @Patch()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBodyPipe(UpdateMeSchema)) body: UpdateMe,
  ): Promise<MeResponse> {
    return this.service.update(user.userId, body);
  }
}
