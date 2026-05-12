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

  isConfigured(): boolean {
    return Boolean(this.env.SLACK_BOT_TOKEN && this.env.SLACK_DEFAULT_CHANNEL_ID);
  }

  defaultChannelId(): string | null {
    return this.env.SLACK_DEFAULT_CHANNEL_ID ?? null;
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
