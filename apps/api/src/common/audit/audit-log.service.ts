import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type { Json } from '@bookingblues/db-types';

import { SupabaseService } from '../supabase/supabase.service';

/**
 * Per CLAUDE.md §11.15: every admin write + a handful of operator-side state
 * changes (subscription, calendar connect/disconnect, number assignment,
 * manual cancel, refund) MUST land in `audit_log`.
 *
 * Append-only by convention — there's no update or delete API here on purpose.
 *
 * Common shape:
 *   action       — verb + object, snake_case (e.g. 'operator.deactivate',
 *                  'payment.refund', 'conversation.force_end', 'admin.promote')
 *   resource_type — 'operator' | 'appointment' | 'payment' | 'conversation' | …
 *   resource_id   — uuid or external id (Stripe pi_*, Twilio MS*, …)
 *   metadata      — small JSON, no PII; reasons, before/after snapshots, etc.
 */
export interface AuditLogWriteArgs {
  readonly actorUserId: string | null;
  readonly operatorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly metadata?: Json;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

@Injectable()
export class AuditLogService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuditLogService.name);
  }

  async write(args: AuditLogWriteArgs): Promise<void> {
    const { error } = await this.supabase
      .db()
      .from('audit_log')
      .insert({
        actor_user_id: args.actorUserId,
        operator_id: args.operatorId,
        action: args.action,
        resource_type: args.resourceType,
        resource_id: args.resourceId,
        metadata: args.metadata ?? {},
        ip_address: args.ipAddress ?? null,
        user_agent: args.userAgent ?? null,
      });
    if (error) {
      // We MUST NOT fail the user's action because audit failed (that would
      // create a denial-of-service vector against admin writes). Log loudly.
      this.logger.error(
        {
          err: error.message,
          action: args.action,
          resourceType: args.resourceType,
          resourceId: args.resourceId,
        },
        'audit_log write failed',
      );
    }
  }

  /**
   * Helper for controllers: pull ip + ua off the Express request once and
   * pass them through `write()` for free.
   */
  fromRequest(req: Request): { ipAddress: string | null; userAgent: string | null } {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      req.ip ||
      null;
    const userAgent = (req.headers['user-agent'] as string | undefined) ?? null;
    return { ipAddress, userAgent };
  }
}
