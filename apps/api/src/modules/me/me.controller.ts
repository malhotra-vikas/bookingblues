import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

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

  // Email change can be abused (account-takeover bait); apply the strict
  // 5-per-15-min limiter from CLAUDE.md §11.7. Overrides the global default.
  @Patch()
  @Throttle({ default: { ttl: 15 * 60_000, limit: 5 } })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBodyPipe(UpdateMeSchema)) body: UpdateMe,
  ): Promise<MeResponse> {
    return this.service.update(user.userId, body);
  }
}
