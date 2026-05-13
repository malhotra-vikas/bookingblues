import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { ExternalServiceError } from '../../common/errors/app-error';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Thin typed wrapper around Slack Web API. Per ADR 0010 — HITL targets a
 * single BookingBlues-team workspace, so every call uses the platform bot
 * token from SLACK_BOT_TOKEN. There's no per-operator install any more.
 *
 * Callers shouldn't pass bot tokens around — this client pulls from env.
 * If SLACK_BOT_TOKEN is unset (e.g. dev without Slack wired), `isConfigured()`
 * returns false and posts fail loud (callers fall back to email).
 */

interface SlackCommonResponse {
  ok: boolean;
  error?: string;
  warning?: string;
}

interface PostMessageResp extends SlackCommonResponse {
  channel?: string;
  ts?: string;
  message?: { ts?: string; user?: string };
}

@Injectable()
export class SlackApiClient {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SlackApiClient.name);
  }

  /** True iff the bot token is configured (any Slack post is feasible). */
  isConfigured(): boolean {
    return Boolean(this.env.SLACK_BOT_TOKEN);
  }

  /** Channel where escalation alarms + buttons post (`#hitl`). */
  defaultChannelId(): string | null {
    return this.env.SLACK_DEFAULT_CHANNEL_ID ?? null;
  }

  /** Channel where every conversation gets a monitoring thread (`#convos`). */
  convosChannelId(): string | null {
    return this.env.SLACK_CONVOS_CHANNEL_ID ?? null;
  }

  /** Channel where new-signup notifications post (`#bb-leads`). */
  leadsChannelId(): string | null {
    return this.env.SLACK_CHANNEL_LEADS_ID ?? null;
  }

  /**
   * chat.getPermalink is one of the few Slack methods that only accepts
   * GET with query-string params, not POST JSON — hence the direct fetch.
   */
  async getPermalink(args: {
    channel: string;
    messageTs: string;
  }): Promise<SlackCommonResponse & { permalink?: string }> {
    const token = this.requireBotToken();
    const qs = new URLSearchParams({ channel: args.channel, message_ts: args.messageTs });
    const res = await fetch(`https://slack.com/api/chat.getPermalink?${qs.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new ExternalServiceError('slack', `chat.getPermalink returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as SlackCommonResponse & { permalink?: string };
    if (!data.ok) this.logger.warn({ method: 'chat.getPermalink', error: data.error }, 'Slack API returned ok=false');
    return data;
  }

  async postMessage(args: {
    channel: string;
    text: string;
    threadTs?: string;
    blocks?: ReadonlyArray<unknown>;
  }): Promise<PostMessageResp> {
    return this.callJson<PostMessageResp>('chat.postMessage', {
      channel: args.channel,
      text: args.text,
      ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
      ...(args.blocks ? { blocks: args.blocks } : {}),
    });
  }

  async openView(args: {
    triggerId: string;
    view: Record<string, unknown>;
  }): Promise<SlackCommonResponse & { view?: { id?: string } }> {
    return this.callJson<SlackCommonResponse & { view?: { id?: string } }>(
      'views.open',
      { trigger_id: args.triggerId, view: args.view },
    );
  }

  // ── internal ─────────────────────────────────────────────────────────────

  private requireBotToken(): string {
    const token = this.env.SLACK_BOT_TOKEN;
    if (!token) {
      throw new ExternalServiceError('slack', 'SLACK_BOT_TOKEN is not configured');
    }
    return token;
  }

  private async callJson<T extends SlackCommonResponse>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const token = this.requireBotToken();
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new ExternalServiceError('slack', `${method} returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as T;
    if (!data.ok) {
      this.logger.warn({ method, error: data.error }, 'Slack API returned ok=false');
    }
    return data;
  }
}
