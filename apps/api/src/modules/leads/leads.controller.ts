import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SlackApiClient } from '../slack/slack-api.client';

const NotifyLeadSchema = z.object({
  user_id: z.string().uuid(),
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

/**
 * Build the Block Kit message for a new lead. Pulled out so the Slack
 * interactivity handler can rebuild + extend it on claim with the same
 * shape.
 */
export function buildLeadBlocks(args: {
  userId: string;
  email: string;
  businessName: string;
  phoneE164: string;
  adminUrl: string;
  /** Override the header line (e.g. when a lead is re-released for claiming). */
  headline?: string;
}): ReadonlyArray<unknown> {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: args.headline ?? `:tada: *New lead* — *${args.businessName}*`,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Email*\n${args.email}` },
        { type: 'mrkdwn', text: `*Phone*\n${maskPhone(args.phoneE164)}` },
      ],
    },
    {
      type: 'actions',
      block_id: `lead_actions_${args.userId}`,
      elements: [
        {
          type: 'button',
          action_id: 'lead_claim',
          style: 'primary',
          text: { type: 'plain_text', text: 'Claim this lead', emoji: true },
          value: args.userId,
        },
        {
          type: 'button',
          action_id: 'lead_view_in_admin',
          text: { type: 'plain_text', text: 'View in admin', emoji: true },
          url: args.adminUrl,
        },
      ],
    },
  ];
}

/**
 * Public new-lead notifier. Called fire-and-forget from the signup form after
 * Supabase Auth `signUp` succeeds. No auth required (the row already exists in
 * `auth.users` at this point), but per-IP throttled to keep the channel quiet
 * if someone scripts the endpoint.
 *
 * Failure is intentionally swallowed — a Slack outage must not block signup.
 *
 * Full email + business name go in the message (per request); the phone is
 * still masked since it's the operator's mobile and not needed for first
 * outreach.
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
    const fallbackText = `New lead: ${businessName} · ${body.email} · ${maskPhone(body.phone_e164)}`;

    try {
      await this.slack.postMessage({
        channel,
        text: fallbackText,
        blocks: buildLeadBlocks({
          userId: body.user_id,
          email: body.email,
          businessName,
          phoneE164: body.phone_e164,
          adminUrl,
        }),
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
