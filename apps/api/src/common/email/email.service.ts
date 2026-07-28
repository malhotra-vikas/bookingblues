import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ExternalServiceError } from '../errors/app-error';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

interface EmailAttachment {
  readonly filename: string;
  /** Base64-encoded file content (Resend `attachments[].content`). */
  readonly content: string;
}

interface SendArgs {
  /** One address, or several to put on the same To: line (e.g. a shared inbox list). */
  readonly to: string | ReadonlyArray<string>;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly replyTo?: string;
  readonly attachments?: ReadonlyArray<EmailAttachment>;
}

interface SendOk {
  readonly delivered: true;
  readonly id: string;
}
interface SendSkipped {
  readonly delivered: false;
  readonly reason: 'not_configured' | 'no_from' | 'send_failed';
  readonly detail?: string;
}
type SendResult = SendOk | SendSkipped;

/**
 * Thin Resend REST wrapper. We don't pull in the `resend` npm package —
 * the API is one POST and SlackApiClient already established the
 * fetch-against-REST pattern, so consistency wins over the SDK ergonomics.
 *
 * Constructor-tolerant in dev: if RESEND_API_KEY or EMAIL_FROM is missing,
 * `send` returns `{delivered:false}` so callers can fire-and-forget without
 * special-casing. Production env validation requires both anyway.
 */
@Injectable()
export class EmailService {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EmailService.name);
  }

  isConfigured(): boolean {
    return Boolean(this.env.RESEND_API_KEY && this.env.EMAIL_FROM);
  }

  async send(args: SendArgs): Promise<SendResult> {
    if (!this.env.RESEND_API_KEY) return { delivered: false, reason: 'not_configured' };
    if (!this.env.EMAIL_FROM) return { delivered: false, reason: 'no_from' };

    const body: Record<string, unknown> = {
      from: this.env.EMAIL_FROM,
      to: Array.isArray(args.to) ? [...args.to] : [args.to as string],
      subject: args.subject,
      html: args.html,
    };
    if (args.text) body.text = args.text;
    if (args.replyTo) body.reply_to = args.replyTo;
    if (args.attachments?.length) body.attachments = args.attachments.map((a) => ({ filename: a.filename, content: a.content }));

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => res.statusText);
        this.logger.warn(
          { status: res.status, to: maskEmail(args.to), detail: detail.slice(0, 200) },
          'resend send failed',
        );
        return { delivered: false, reason: 'send_failed', detail: detail.slice(0, 200) };
      }
      const data = (await res.json()) as { id?: string };
      return { delivered: true, id: data.id ?? '' };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: detail, to: maskEmail(args.to) }, 'resend network error');
      return { delivered: false, reason: 'send_failed', detail };
    }
  }

  /** Throw-on-fail variant for code paths that should surface email failures. */
  async sendOrThrow(args: SendArgs): Promise<SendOk> {
    const r = await this.send(args);
    if (!r.delivered) {
      throw new ExternalServiceError(
        'resend',
        `email send failed: ${r.reason}${r.detail ? ` (${r.detail.slice(0, 100)})` : ''}`,
      );
    }
    return r;
  }
}

/** CLAUDE.md §2/§11.5: emails are logged as first-char + domain only, never in full. */
function maskEmail(email: string | ReadonlyArray<string>): string {
  if (Array.isArray(email)) return email.map((e) => maskEmail(e as string)).join(', ');
  const [local, domain] = (email as string).split('@');
  if (!local || !domain) return email as string;
  return `${local[0] ?? '•'}•••@${domain}`;
}
