import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { EmailService } from '../../common/email/email.service';
import { fetchAdminEmails, fetchOperatorEmail } from '../../common/email/staff-recipients';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { EmailContent, OperatorRef } from './usage-emails';

/**
 * Sends a usage/billing alert to the operator AND every KeeprSteady admin
 * (auth users with `app_metadata.role = 'admin'`, looked up live). An alert
 * must never block the caller flow or a Stripe webhook, so send failures are
 * logged loudly instead of thrown — the dedupe rows mean we don't retry.
 */
@Injectable()
export class UsageNotifierService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UsageNotifierService.name);
  }

  get appUrl(): string {
    return this.env.APP_URL.replace(/\/$/, '');
  }

  async loadOperatorRef(operatorId: string): Promise<(OperatorRef & { userId: string }) | null> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('id, business_name, plan, user_id')
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: data.id, businessName: data.business_name, plan: data.plan, userId: data.user_id };
  }

  async send(
    kind: string,
    target: OperatorRef & { userId: string },
    content: { operator: EmailContent; admin: EmailContent },
  ): Promise<void> {
    const [operatorEmail, adminEmails] = await Promise.all([
      this.operatorEmail(target.userId),
      this.adminEmails(),
    ]);

    const sends: Array<Promise<void>> = [];
    if (operatorEmail) {
      sends.push(this.deliver(kind, 'operator', target.id, operatorEmail, content.operator));
    } else {
      this.logger.error({ operatorId: target.id, kind }, 'usage alert: operator has no email');
    }
    if (adminEmails.length > 0) {
      sends.push(this.deliver(kind, 'admin', target.id, adminEmails, content.admin));
    } else {
      this.logger.error({ operatorId: target.id, kind }, 'usage alert: no admin users to notify');
    }
    await Promise.all(sends);
  }

  private async deliver(
    kind: string,
    audience: 'operator' | 'admin',
    operatorId: string,
    to: string | string[],
    content: EmailContent,
  ): Promise<void> {
    const res = await this.email.send({ to, subject: content.subject, html: content.html, text: content.text });
    if (res.delivered) {
      this.logger.info({ operatorId, kind, audience }, 'usage alert email sent');
    } else {
      this.logger.error(
        { operatorId, kind, audience, reason: res.reason, detail: res.detail },
        'usage alert email NOT sent',
      );
    }
  }

  private async operatorEmail(userId: string): Promise<string | null> {
    try {
      return await fetchOperatorEmail(this.supabase.db(), userId);
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'usage alert: operator user lookup failed');
      return null;
    }
  }

  private async adminEmails(): Promise<string[]> {
    try {
      return await fetchAdminEmails(this.supabase.db());
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'usage alert: admin listing failed');
      return [];
    }
  }
}
