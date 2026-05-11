import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { AppError, ExternalServiceError } from '../../common/errors/app-error';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

/**
 * Thin typed wrapper around Slack Web API. Per CLAUDE.md §11 — we do not
 * pull `@slack/web-api` in MVP; the official SDK is heavy and pulls retry
 * logic we don't need yet. A small fetch wrapper is enough for the calls we
 * make: chat.postMessage, conversations.create, conversations.invite,
 * oauth.v2.access. Re-evaluate when we add more surface.
 *
 * Every method that posts to a workspace requires the operator's per-install
 * bot token (decrypted at the call site).
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

interface OAuthV2AccessResp extends SlackCommonResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name?: string };
  authed_user?: { id?: string };
  incoming_webhook?: { channel?: string; channel_id?: string };
}

interface ConversationsCreateResp extends SlackCommonResponse {
  channel?: { id?: string; name?: string };
}

interface ConversationsListResp extends SlackCommonResponse {
  channels?: Array<{ id: string; name: string; is_private?: boolean; is_archived?: boolean }>;
  response_metadata?: { next_cursor?: string };
}

@Injectable()
export class SlackApiClient {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SlackApiClient.name);
  }

  /** OAuth code exchange — uses the app-level client id/secret, not a bot token. */
  async exchangeOauthCode(code: string, redirectUri: string): Promise<OAuthV2AccessResp> {
    if (!this.env.SLACK_CLIENT_ID || !this.env.SLACK_CLIENT_SECRET) {
      throw new AppError({
        code: 'slack.no_credentials',
        status: 500,
        detail: 'Slack OAuth requires SLACK_CLIENT_ID and SLACK_CLIENT_SECRET',
      });
    }
    const body = new URLSearchParams({
      code,
      client_id: this.env.SLACK_CLIENT_ID,
      client_secret: this.env.SLACK_CLIENT_SECRET,
      redirect_uri: redirectUri,
    });
    return this.callForm<OAuthV2AccessResp>('oauth.v2.access', body, undefined);
  }

  async postMessage(args: {
    botToken: string;
    channel: string;
    text: string;
    threadTs?: string;
    blocks?: ReadonlyArray<unknown>;
  }): Promise<PostMessageResp> {
    return this.callJson<PostMessageResp>('chat.postMessage', args.botToken, {
      channel: args.channel,
      text: args.text,
      ...(args.threadTs ? { thread_ts: args.threadTs } : {}),
      ...(args.blocks ? { blocks: args.blocks } : {}),
    });
  }

  async createPrivateChannel(args: {
    botToken: string;
    name: string;
  }): Promise<ConversationsCreateResp> {
    return this.callJson<ConversationsCreateResp>('conversations.create', args.botToken, {
      name: args.name,
      is_private: true,
    });
  }

  async listChannels(args: {
    botToken: string;
    cursor?: string;
    types?: string; // e.g. 'public_channel,private_channel'
  }): Promise<ConversationsListResp> {
    return this.callJson<ConversationsListResp>('conversations.list', args.botToken, {
      limit: 200,
      types: args.types ?? 'public_channel,private_channel',
      ...(args.cursor ? { cursor: args.cursor } : {}),
    });
  }

  async inviteToChannel(args: {
    botToken: string;
    channel: string;
    users: ReadonlyArray<string>;
  }): Promise<SlackCommonResponse> {
    return this.callJson<SlackCommonResponse>('conversations.invite', args.botToken, {
      channel: args.channel,
      users: args.users.join(','),
    });
  }

  // ── internal ─────────────────────────────────────────────────────────────

  private async callJson<T extends SlackCommonResponse>(
    method: string,
    botToken: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(method, res);
  }

  private async callForm<T extends SlackCommonResponse>(
    method: string,
    form: URLSearchParams,
    botToken: string | undefined,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (botToken) headers.authorization = `Bearer ${botToken}`;
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers,
      body: form.toString(),
    });
    return this.handleResponse<T>(method, res);
  }

  private async handleResponse<T extends SlackCommonResponse>(
    method: string,
    res: Response,
  ): Promise<T> {
    if (!res.ok) {
      // Slack's app-level HTTP errors are rare — most failures land as `ok:false`.
      throw new ExternalServiceError('slack', `${method} returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as T;
    if (!data.ok) {
      // Surface known recoverable errors as warnings — callers branch on data.error.
      // Don't throw; the caller decides whether to retry / fall back.
      this.logger.warn({ method, error: data.error }, 'Slack API returned ok=false');
    }
    return data;
  }
}
