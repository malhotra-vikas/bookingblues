import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AdminGuard } from '../../common/auth/admin.guard';
import { AdminReadService } from './admin-read.service';

/**
 * Read-only admin endpoints. All routes are JWT-required + `role=admin` (see
 * AdminGuard, ADR 0009). Throttling is tighter than operator endpoints (30/min)
 * because admin actions are inherently sensitive — a runaway client should hit
 * the limit and surface a problem rather than DoSing the back office.
 */
@Controller('admin')
@UseGuards(AdminGuard)
@Throttle({ default: { ttl: 60_000, limit: 30 } })
export class AdminReadController {
  constructor(private readonly read: AdminReadService) {}

  @Get('metrics')
  async metrics() {
    return this.read.globalMetrics();
  }

  @Get('operators')
  async listOperators(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('has_twilio') hasTwilio?: string,
    @Query('has_calendar') hasCalendar?: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit?: number,
  ) {
    return this.read.listOperators({
      ...(cursor ? { cursor } : {}),
      ...(q ? { q } : {}),
      ...(status ? { status } : {}),
      ...(hasTwilio != null ? { hasTwilio: hasTwilio === 'true' } : {}),
      ...(hasCalendar != null ? { hasCalendar: hasCalendar === 'true' } : {}),
      limit: limit ?? 25,
    });
  }

  @Get('operators/:id')
  async dossier(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.read.getOperatorDossier(id);
  }

  @Get('operators/:id/conversations')
  async conversations(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.read.listOperatorConversations(id, {
      limit: limit ?? 50,
      ...(cursor ? { cursor } : {}),
    });
  }

  @Get('conversations/:id/messages')
  async messages(@Param('id', new ParseUUIDPipe()) id: string) {
    return { items: await this.read.listConversationMessages(id) };
  }

  @Get('operators/:id/appointments')
  async appointments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.read.listOperatorAppointments(id, {
      limit: limit ?? 50,
      ...(cursor ? { cursor } : {}),
    });
  }

  @Get('operators/:id/payments')
  async payments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.read.listOperatorPayments(id, {
      limit: limit ?? 50,
      ...(cursor ? { cursor } : {}),
    });
  }

  @Get('operators/:id/audit-log')
  async auditLog(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit?: number,
  ) {
    return this.read.listOperatorAuditLog(id, {
      limit: limit ?? 100,
      ...(cursor ? { cursor } : {}),
    });
  }
}
