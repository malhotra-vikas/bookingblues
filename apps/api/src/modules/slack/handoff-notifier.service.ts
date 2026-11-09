import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { EmailService } from '../../common/email/email.service';
import { fetchAdminEmails, fetchOperatorEmail } from '../../common/email/staff-recipients';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { handoffEmails, type HandoffEmail, type HandoffEmailContent } from './handoff-emails';

/**
 * Emails the operator and every KeeprSteady admin when the bot hands a caller to
 * a person. Runs alongside the #hitl Slack alarm, not instead of it. Never
 * throws: a mail problem must not stop the handoff, so failures are logged loudly.
 */
@Injectable()
export class HandoffNotifierService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly email: EmailService,
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HandoffNotifierService.name);
  }

  async notify(args: {
    operator: { id: string; user_id: string; business_name: string };
    conversationId: string;
    callerPhoneE164: string;
    content: HandoffEmailContent;
  }): Promise<void> {
    const log = { operatorId: args.operator.id, conversationId: args.conversationId };
    try {
      const emails = handoffEmails({
        businessName: args.operator.business_name,
        callerPhoneE164: args.callerPhoneE164,
        conversationId: args.conversationId,
        operatorId: args.operator.id,
        appUrl: this.env.APP_URL.replace(/\/$/, ''),
        content: args.content,
      });
      const [operatorEmail, adminEmails] = await Promise.all([
        fetchOperatorEmail(this.supabase.db(), args.operator.user_id).catch((err: Error) => {
          this.logger.error({ ...log, err: err.message }, 'handoff email: operator lookup failed');
          return null;
        }),
        fetchAdminEmails(this.supabase.db()).catch((err: Error) => {
          this.logger.error({ ...log, err: err.message }, 'handoff email: admin lookup failed');
          return [] as string[];
        }),
      ]);

      const sends: Array<Promise<void>> = [];
      if (operatorEmail) sends.push(this.deliver('operator', operatorEmail, emails.operator, log));
      else this.logger.error(log, 'handoff email: operator has no email');
      if (adminEmails.length > 0) sends.push(this.deliver('admin', adminEmails, emails.admin, log));
      else this.logger.error(log, 'handoff email: no admin users to notify');
      await Promise.all(sends);
    } catch (err) {
      this.logger.error({ ...log, err: (err as Error).message }, 'handoff email failed');
    }
  }

  private async deliver(
    audience: 'operator' | 'admin',
    to: string | string[],
    content: HandoffEmail,
    log: { operatorId: string; conversationId: string },
  ): Promise<void> {
    const res = await this.email.send({ to, subject: content.subject, html: content.html, text: content.text });
    if (res.delivered) {
      this.logger.info({ ...log, audience }, 'handoff email sent');
    } else {
      this.logger.error(
        { ...log, audience, reason: res.reason, detail: res.detail },
        'handoff email NOT sent',
      );
    }
  }
}
