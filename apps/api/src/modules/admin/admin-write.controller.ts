import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { AdminGuard } from '../../common/auth/admin.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import {
  CancelSubscriptionSchema,
  DeactivateOperatorSchema,
  ForceEndConversationSchema,
  ImpersonateSchema,
  MarkEmailVerifiedSchema,
  PromoteAdminSchema,
  PromoteSalesSchema,
  RefundPaymentSchema,
  ReleaseSalesLeadsSchema,
  type CancelSubscription,
  type DeactivateOperator,
  type ForceEndConversation,
  type Impersonate,
  type MarkEmailVerified,
  type PromoteAdmin,
  type PromoteSales,
  type RefundPayment,
  type ReleaseSalesLeads,
} from './admin.dto';
import { AdminWriteService } from './admin-write.service';

/**
 * Admin write actions. Throttled at 10 req/min to discourage automation; an
 * admin who's intentionally batching should call the underlying Stripe/Twilio
 * APIs directly or coordinate via Slack.
 */
@Controller('admin')
@UseGuards(AdminGuard)
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class AdminWriteController {
  constructor(
    private readonly write: AdminWriteService,
    private readonly audit: AuditLogService,
  ) {}

  // ── admin user management ─────────────────────────────────────────────

  @Post('admins')
  async promoteAdmin(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodBodyPipe(PromoteAdminSchema)) body: PromoteAdmin,
  ): Promise<{ user_id: string }> {
    const ctx = this.audit.fromRequest(req);
    return this.write.promoteAdmin({
      email: body.user_email,
      actor: { actorUserId: actor.userId, ...ctx },
    });
  }

  @Delete('admins/:userId')
  async demoteAdmin(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<{ ok: true }> {
    const ctx = this.audit.fromRequest(req);
    await this.write.demoteAdmin({
      userId,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true };
  }

  // ── sales rep management (#4) ─────────────────────────────────────────────

  @Post('sales')
  async promoteSales(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodBodyPipe(PromoteSalesSchema)) body: PromoteSales,
  ): Promise<{ user_id: string }> {
    const ctx = this.audit.fromRequest(req);
    return this.write.promoteSales({
      email: body.user_email,
      slackUserId: body.slack_user_id,
      ...(body.slack_username !== undefined ? { slackUsername: body.slack_username } : {}),
      actor: { actorUserId: actor.userId, ...ctx },
    });
  }

  @Delete('sales/:userId')
  async demoteSales(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<{ ok: true }> {
    const ctx = this.audit.fromRequest(req);
    await this.write.demoteSales({
      userId,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true };
  }

  @Post('sales/:userId/release-leads')
  async releaseSalesLeads(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodBodyPipe(ReleaseSalesLeadsSchema)) body: ReleaseSalesLeads,
  ): Promise<{ ok: true; released_leads: number }> {
    const ctx = this.audit.fromRequest(req);
    const { released_leads } = await this.write.releaseSalesLeads({
      userId,
      leadUserIds: body.lead_user_ids,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true, released_leads };
  }

  // ── lead actions ───────────────────────────────────────────────────────

  @Post('leads/:userId/verify-email')
  async markEmailVerified(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodBodyPipe(MarkEmailVerifiedSchema)) body: MarkEmailVerified,
  ): Promise<{ ok: true; user_id: string; email: string | null }> {
    const ctx = this.audit.fromRequest(req);
    const r = await this.write.markEmailVerified({
      userId,
      reason: body.reason,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true, ...r };
  }

  // ── operator lifecycle ─────────────────────────────────────────────────

  @Post('operators/:id/deactivate')
  async deactivate(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) operatorId: string,
    @Body(new ZodBodyPipe(DeactivateOperatorSchema)) body: DeactivateOperator,
  ): Promise<{ ok: true }> {
    const ctx = this.audit.fromRequest(req);
    await this.write.deactivateOperator({
      operatorId,
      reason: body.reason,
      immediate: body.immediate,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true };
  }

  @Post('operators/:id/cancel-subscription')
  async cancelSubscription(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) operatorId: string,
    @Body(new ZodBodyPipe(CancelSubscriptionSchema)) body: CancelSubscription,
  ): Promise<{ ok: true }> {
    const ctx = this.audit.fromRequest(req);
    await this.write.cancelSubscription({
      operatorId,
      reason: body.reason,
      immediate: body.immediate,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true };
  }

  @Post('operators/:id/release-twilio-number')
  async releaseTwilio(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) operatorId: string,
  ): Promise<{ ok: true }> {
    const ctx = this.audit.fromRequest(req);
    await this.write.releaseTwilioNumber({
      operatorId,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true };
  }

  @Post('operators/:id/refund-payment/:paymentId')
  async refundPayment(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) operatorId: string,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body(new ZodBodyPipe(RefundPaymentSchema)) body: RefundPayment,
  ): Promise<{ ok: true }> {
    const ctx = this.audit.fromRequest(req);
    await this.write.refundPayment({
      operatorId,
      paymentId,
      reason: body.reason,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true };
  }

  @Post('operators/:id/impersonate')
  async impersonate(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) operatorId: string,
    @Body(new ZodBodyPipe(ImpersonateSchema)) body: Impersonate,
  ): Promise<{ action_link: string }> {
    const ctx = this.audit.fromRequest(req);
    return this.write.impersonateOperator({
      operatorId,
      reason: body.reason,
      actor: { actorUserId: actor.userId, ...ctx },
    });
  }

  // ── conversations ─────────────────────────────────────────────────────

  @Post('conversations/:id/force-end')
  async forceEnd(
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) conversationId: string,
    @Body(new ZodBodyPipe(ForceEndConversationSchema)) body: ForceEndConversation,
  ): Promise<{ ok: true }> {
    const ctx = this.audit.fromRequest(req);
    await this.write.forceEndConversation({
      conversationId,
      outcome: body.outcome,
      reason: body.reason,
      actor: { actorUserId: actor.userId, ...ctx },
    });
    return { ok: true };
  }
}
