import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SlackApiClient } from '../slack/slack-api.client';

const NotifyLeadSchema = z.object({
  email: z.string().email(),
  business_name: z.string().trim().min(1).max(120),
  phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'phone must be E.164 (+15551234567)'),
});

type NotifyLeadDto = z.infer<typeof NotifyLeadSchema>;

function maskPhone(e164: string): string {
  return `•••${e164.slice(-4)}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local[0] ?? '•'}•••@${domain}`;
}

/**
 * Public new-lead notifier. Called fire-and-forget from the signup form after
 * Supabase Auth `signUp` succeeds. No auth required (the row already exists in
 * `auth.users` at this point), but per-IP throttled to keep the channel quiet
 * if someone scripts the endpoint.
 *
 * Failure is intentionally swallowed — a Slack outage must not block signup.
 */
@Controller('leads')
export class LeadsController {
  constructor(
    private readonly slack: SlackApiClient,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(LeadsController.name);
  }

  @Post('notify')
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async notify(@Body(new ZodBodyPipe(NotifyLeadSchema)) body: NotifyLeadDto): Promise<{ ok: true }> {
    const channel = this.slack.leadsChannelId();
    if (!this.slack.isConfigured() || !channel) {
      // Slack not wired — no-op. Still ack 202 so the client doesn't retry.
      return { ok: true };
    }

    const adminUrl = `${this.env.APP_URL.replace(/\/$/, '')}/admin/leads`;
    const businessName = body.business_name;
    const fallbackText = `New lead: ${businessName} · ${maskEmail(body.email)} · ${maskPhone(body.phone_e164)}`;

    try {
      await this.slack.postMessage({
        channel,
        text: fallbackText,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:tada: *New lead* — *${businessName}*`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Email*\n${maskEmail(body.email)}` },
              { type: 'mrkdwn', text: `*Phone*\n${maskPhone(body.phone_e164)}` },
            ],
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'View in admin', emoji: true },
                url: adminUrl,
              },
            ],
          },
        ],
      });
    } catch (err) {
      // Best-effort. Loud log, don't fail the request — signup already
      // succeeded; this is just a notification.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: msg }, 'leads: Slack post failed');
    }

    return { ok: true };
  }
}
