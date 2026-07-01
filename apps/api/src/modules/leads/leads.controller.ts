import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PinoLogger } from 'nestjs-pino';
import { z } from 'zod';

import { ZodBodyPipe } from '../../common/pipes/zod-body.pipe';
import { SupabaseService } from '../../common/supabase/supabase.service';
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
  /**
   * Optional sales-rep referral entered at signup (the rep's Slack member ID,
   * e.g. `U0B1AJTVA9J`). If it matches a known rep, the lead is pre-assigned to
   * them so it can't be claimed by anyone else. Anything unrecognized is
   * ignored and the lead posts as normally claimable.
   */
  sales_ref: z.string().trim().max(40).optional(),
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
  /**
   * When set, the lead is PRE-ASSIGNED to this rep (referral at signup). We drop
   * the Claim button and show a lock banner so no one else can grab it — same
   * shape as a manually-claimed lead.
   */
  preassignedSlackUserId?: string;
}): ReadonlyArray<unknown> {
  const info = [
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
  ];

  if (args.preassignedSlackUserId) {
    return [
      ...info,
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `:lock: Pre-assigned to <@${args.preassignedSlackUserId}> (referral at signup)`,
          },
        ],
      },
    ];
  }

  return [
    ...info,
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
    private readonly supabase: SupabaseService,
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

    // Referral pre-assignment: if the signup carried a valid sales-rep Slack ID,
    // claim the lead for that rep right now so it can't be grabbed by anyone
    // else. Best-effort — a bad/unknown ref just falls through to a claimable
    // post; nothing here may block the lead notification.
    const preassigned = body.sales_ref ? await this.resolveAndPreassign(body) : null;

    const adminUrl = `${this.env.APP_URL.replace(/\/$/, '')}/admin/leads`;
    const businessName = body.business_name;
    const fallbackText = preassigned
      ? `New lead: ${businessName} · pre-assigned to <@${preassigned.slackUserId}>`
      : `New lead: ${businessName} · ${body.email} · ${maskPhone(body.phone_e164)}`;

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
          ...(preassigned ? { preassignedSlackUserId: preassigned.slackUserId } : {}),
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

  /**
   * Resolve a signup referral (a rep's Slack member ID) to a known sales rep and
   * pre-assign this lead to them by writing the `lead_claims` row. Returns the
   * rep on success, null if the ref is unknown or anything fails — the caller
   * then posts a normally-claimable lead. Never throws.
   */
  private async resolveAndPreassign(
    body: NotifyLeadDto,
  ): Promise<{ slackUserId: string; slackUsername: string | null } | null> {
    // Slack member IDs are uppercase (U…/W…); normalize so casing/whitespace in
    // the typed referral doesn't cause a miss.
    const ref = (body.sales_ref ?? '').trim().toUpperCase();
    if (!/^[UW][A-Z0-9]{6,}$/.test(ref)) return null;
    try {
      // Only a linked, promoted rep can receive a referral (guards against a
      // lead pre-assigning to an arbitrary Slack ID).
      const { data: rep } = await this.supabase
        .db()
        .from('sales_slack_links')
        .select('slack_user_id, slack_username')
        .eq('slack_user_id', ref)
        .maybeSingle();
      if (!rep) {
        this.logger.info({ ref }, 'leads: referral did not match a known sales rep — posting as claimable');
        return null;
      }

      const { error } = await this.supabase
        .db()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('lead_claims' as any)
        .upsert(
          {
            user_id: body.user_id,
            claimed_by_slack_user_id: rep.slack_user_id,
            claimed_by_slack_username: rep.slack_username,
            claimed_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
      if (error) {
        this.logger.warn({ err: error.message, ref }, 'leads: pre-assign upsert failed — posting as claimable');
        return null;
      }
      return { slackUserId: rep.slack_user_id, slackUsername: rep.slack_username };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message, ref }, 'leads: pre-assign errored — posting as claimable');
      return null;
    }
  }
}
