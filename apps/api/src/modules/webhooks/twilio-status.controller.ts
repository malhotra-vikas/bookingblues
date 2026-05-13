import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Json } from '@bookingblues/db-types';
import { PinoLogger } from 'nestjs-pino';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SlackApiClient } from '../slack/slack-api.client';
import { verifyTwilioSignature } from './twilio-helpers';

interface TwilioStatusForm {
  readonly MessageSid?: string;
  readonly MessageStatus?: string;
  readonly SmsStatus?: string;
  readonly ErrorCode?: string;
  readonly To?: string;
  readonly From?: string;
  readonly [k: string]: string | undefined;
}

/**
 * Twilio Message Status Callback — fired on every state transition for an
 * outbound SMS (queued → sent → delivered, or → failed/undelivered). We use
 * it to swap the ⏳/✅/❌ marker on the message's Slack echo so the team can
 * see real carrier-confirmed delivery instead of just "the Twilio API
 * returned 200".
 *
 * Mounted at /webhooks/twilio/status (no per-operator path — the operator
 * is implicit in the MessageSid → messages → conversation → operator chain).
 * Idempotency: `(twilio, sid|status)` synthetic event_id in webhook_events.
 * Twilio retries the same (sid, status) on 5xx but each distinct status
 * transition is its own event.
 */
@Controller('webhooks/twilio/status')
@SkipThrottle()
export class TwilioStatusController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly twilio: TwilioService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly slackApi: SlackApiClient,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(TwilioStatusController.name);
  }

  @Post()
  @HttpCode(200)
  @Header('content-type', 'text/xml')
  async handle(@Req() req: Request, @Body() form: TwilioStatusForm): Promise<string> {
    verifyTwilioSignature({
      twilio: this.twilio,
      apiUrl: this.env.API_URL,
      req,
      formBody: form as Record<string, string>,
    });

    const sid = form.MessageSid;
    const status = (form.MessageStatus ?? form.SmsStatus ?? '').toLowerCase();
    if (!sid || !status) return this.ack();

    // Synthetic idempotency key — same (sid, status) shouldn't double-process,
    // but distinct status transitions for the same sid are independent events.
    const recorded = await this.idempotency.record({
      source: 'twilio',
      eventId: `${sid}|${status}`,
      payload: form as unknown as Json,
      signatureVerified: true,
    });
    if (recorded.status === 'duplicate') return this.ack();

    try {
      await this.applyStatus({
        sid,
        status,
        ...(form.ErrorCode ? { errorCode: form.ErrorCode } : {}),
      });
      await this.idempotency.markProcessed(recorded.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.idempotency.markFailed(recorded.id, msg);
      this.logger.error({ err: msg, sid, status }, 'twilio status callback failed');
      // Don't 5xx — Twilio would retry-storm. We've recorded the failure for
      // manual replay if needed.
    }

    return this.ack();
  }

  private async applyStatus(args: {
    sid: string;
    status: string;
    errorCode?: string;
  }): Promise<void> {
    const allowed = new Set(['queued', 'sent', 'delivered', 'failed', 'undelivered']);
    const normalized = allowed.has(args.status) ? args.status : 'unknown';

    // Fetch the message row so we know whether to chat.update (bot-authored)
    // or reactions.add/remove (agent-authored). Cast to any because db-types
    // hasn't been regenerated since the delivery_status migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data: msg, error: lookupErr } = await client
      .from('messages')
      .select('id, role, body, delivery_status, slack_channel_id, slack_message_ts')
      .eq('twilio_message_sid', args.sid)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!msg) {
      this.logger.info({ sid: args.sid, status: normalized }, 'status callback for unknown sid');
      return;
    }

    // Don't go backwards: terminal states (delivered/failed/undelivered)
    // shouldn't be overwritten by a stale 'sent' that arrives out of order.
    const TERMINAL = new Set(['delivered', 'failed', 'undelivered']);
    if (TERMINAL.has(msg.delivery_status) && !TERMINAL.has(normalized)) {
      return;
    }

    const update: Record<string, unknown> = { delivery_status: normalized };
    if (normalized === 'delivered') update.delivered_at = new Date().toISOString();
    if (args.errorCode) update.delivery_error_code = args.errorCode;

    const { error: updErr } = await client
      .from('messages')
      .update(update)
      .eq('id', msg.id);
    if (updErr) throw updErr;

    // Slack-side marker. Best-effort: log + swallow so a Slack outage doesn't
    // bubble back to Twilio as a 5xx and trigger a retry storm.
    if (msg.slack_channel_id && msg.slack_message_ts && this.slackApi.isConfigured()) {
      try {
        await this.updateSlackMarker({
          role: msg.role,
          body: msg.body ?? '',
          channel: msg.slack_channel_id,
          ts: msg.slack_message_ts,
          status: normalized,
          ...(args.errorCode ? { errorCode: args.errorCode } : {}),
        });
      } catch (err) {
        this.logger.warn(
          { err: (err as Error).message, sid: args.sid, status: normalized },
          'slack marker update failed (non-fatal)',
        );
      }
    }
  }

  private async updateSlackMarker(args: {
    role: 'caller' | 'bot' | 'system' | string;
    body: string;
    channel: string;
    ts: string;
    status: string;
    errorCode?: string;
  }): Promise<void> {
    // For bot-authored Slack echoes we use chat.update on the text (we
    // posted it). For agent-bridged messages the agent posted the original
    // — Slack only lets a bot edit its own posts — so use reactions instead.
    if (args.role === 'bot') {
      const text = this.buildBotEchoText({ body: args.body, status: args.status });
      if (!text) return;
      await this.slackApi.updateMessage({ channel: args.channel, ts: args.ts, text });
      return;
    }
    if (args.role === 'system') {
      await this.applyAgentReactions({
        channel: args.channel,
        ts: args.ts,
        status: args.status,
      });
      return;
    }
    // role='caller' or anything else: no marker.
  }

  /**
   * Rebuild the #convos bot-echo text with the right marker prefix. Mirrors
   * the truncation in escalations.service.ts:echoBotReplyToOpenEscalation so
   * the edit doesn't lengthen the message past Slack's display width.
   */
  private buildBotEchoText(args: { body: string; status: string }): string | null {
    let marker: string | null = null;
    if (args.status === 'delivered') marker = '✅';
    else if (args.status === 'failed' || args.status === 'undelivered') marker = '❌';
    else if (args.status === 'queued' || args.status === 'sent') marker = '⏳';
    if (!marker) return null;
    const truncated = args.body.length > 480 ? `${args.body.slice(0, 480)}…` : args.body;
    return `${marker} 🤖 Bot: ${truncated}`;
  }

  private async applyAgentReactions(args: {
    channel: string;
    ts: string;
    status: string;
  }): Promise<void> {
    // For agent-typed messages we use emoji reactions instead of chat.update
    // (the bot can't edit the agent's own message).
    if (args.status === 'delivered') {
      await this.swapReaction({
        channel: args.channel,
        ts: args.ts,
        remove: 'hourglass_flowing_sand',
        add: 'white_check_mark',
      });
    } else if (args.status === 'failed' || args.status === 'undelivered') {
      await this.swapReaction({
        channel: args.channel,
        ts: args.ts,
        remove: 'hourglass_flowing_sand',
        add: 'x',
      });
    }
  }

  private async swapReaction(args: {
    channel: string;
    ts: string;
    remove: string;
    add: string;
  }): Promise<void> {
    // Best-effort. The hourglass may already be gone (if we missed the send-
    // time add) and the new emoji may already be there (replay) — both are
    // benign ok=false from Slack.
    await this.slackApi.removeReaction({
      channel: args.channel,
      timestamp: args.ts,
      name: args.remove,
    });
    await this.slackApi.addReaction({
      channel: args.channel,
      timestamp: args.ts,
      name: args.add,
    });
  }

  private ack(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  }
}
