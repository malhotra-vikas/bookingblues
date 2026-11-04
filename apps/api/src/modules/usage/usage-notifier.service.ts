import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { EmailService } from '../../common/email/email.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import type { EmailContent, OperatorRef } from './usage-emails';

const ADMIN_PAGE_SIZE = 200;

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
    const { data, error } = await this.supabase.db().auth.admin.getUserById(userId);
    if (error) {
      this.logger.error({ err: error.message }, 'usage alert: operator user lookup failed');
      return null;
    }
    return data.user?.email ?? null;
  }

  private async adminEmails(): Promise<string[]> {
    const out: string[] = [];
    for (let page = 1; ; page += 1) {
      const { data, error } = await this.supabase
        .db()
        .auth.admin.listUsers({ page, perPage: ADMIN_PAGE_SIZE });
      if (error) {
        this.logger.error({ err: error.message }, 'usage alert: admin listing failed');
        return out;
      }
      for (const u of data.users) {
        const role = (u.app_metadata as { role?: unknown } | undefined)?.role;
        if (role === 'admin' && u.email) out.push(u.email);
      }
      if (data.users.length < ADMIN_PAGE_SIZE) return out;
    }
  }
}
