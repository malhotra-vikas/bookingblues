import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { SalesGuard } from '../../common/auth/sales.guard';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';

import {
  CreateSalesLeadSchema,
  SalesImpersonateSchema,
  type CreateSalesLead,
  type SalesImpersonate,
} from './sales.dto';
import type { ClaimedLead } from './sales.service';
import { SalesService } from './sales.service';

/**
 * Sales-rep surface (#4). Gated by SalesGuard (role 'sales' or 'admin'); the
 * service additionally scopes every action to leads the rep actually claimed.
 */
@Controller('sales')
@UseGuards(SalesGuard)
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('leads')
  async leads(@CurrentUser() user: AuthenticatedUser): Promise<{ data: ClaimedLead[] }> {
    return this.sales.listClaimedLeads(user.userId);
  }

  /** Onboard a new client on the rep's behalf — auto-tagged to them. */
  @Post('leads')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async createLead(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodBodyPipe(CreateSalesLeadSchema)) body: CreateSalesLead,
  ): Promise<{ lead_user_id: string; email: string }> {
    const ctx = this.audit.fromRequest(req);
    return this.sales.createLead({
      email: body.email,
      businessName: body.business_name,
      phoneE164: body.phone_e164,
      actor: { salesUserId: user.userId, ...ctx },
    });
  }

  @Post('operators/:id/impersonate')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async impersonate(
    @Req() req: Request,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) operatorId: string,
    @Body(new ZodBodyPipe(SalesImpersonateSchema)) body: SalesImpersonate,
  ): Promise<{ action_link: string }> {
    const ctx = this.audit.fromRequest(req);
    return this.sales.impersonateOperator({
      operatorId,
      reason: body.reason,
      actor: { salesUserId: user.userId, ...ctx },
    });
  }
}
