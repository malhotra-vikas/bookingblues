import { createHmac, timingSafeEqual } from 'node:crypto';

import { Controller, Get, Inject, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../common/auth/jwt-verifier.service';
import { AppError, UnauthorizedError, ValidationError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

import { SlackApiClient } from './slack-api.client';
import { SlackConnectionsService } from './slack-connections.service';

/**
 * OAuth install flow.
 *
 *   1. Operator clicks "Connect Slack" in the dashboard.
 *   2. GET /v1/operators/me/slack/install → returns the Slack OAuth URL with
 *      `state` = HMAC-signed payload encoding the operator id + a nonce.
 *   3. Slack redirects to GET /webhooks/slack/oauth/callback (public).
 *   4. We verify state, exchange code for bot token, store encrypted, then
 *      303-redirect the operator back to the dashboard.
 */
const BOT_SCOPES = [
  'chat:write',
  'channels:history',
  'channels:read',
  'groups:history',
  'groups:read',
  'im:history',
  'app_mentions:read',
  'commands',
  'users:read',
  'team:read',
] as const;

@Controller()
export class SlackInstallController {
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly slackApi: SlackApiClient,
    private readonly connections: SlackConnectionsService,
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SlackInstallController.name);
  }

  /**
   * Returns an OAuth URL the operator should open in their browser.
   * Authed: must be a logged-in operator (we sign the state with their id).
   */
  @Get('v1/operators/me/slack/install')
  @UseGuards(AuthGuard)
  async install(@CurrentUser() user: AuthenticatedUser): Promise<{ url: string }> {
    this.requireSlackCreds();
    const operator = await this.requireOperatorByUserId(user.userId);
    const state = this.signState({ operator_id: operator.id, nonce: cryptoRandomHex(12) });
    const redirectUri = this.redirectUri();
    const url = new URL('https://slack.com/oauth/v2/authorize');
    url.searchParams.set('client_id', this.env.SLACK_CLIENT_ID!);
    url.searchParams.set('scope', BOT_SCOPES.join(','));
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    return { url: url.toString() };
  }

  @Get('webhooks/slack/oauth/callback')
  async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') errorParam?: string,
  ): Promise<void> {
    if (errorParam) {
      this.logger.warn({ error: errorParam }, 'Slack OAuth returned error');
      res.redirect(303, `${this.env.APP_URL}/settings/slack?error=${encodeURIComponent(errorParam)}`);
      return;
    }
    if (!code || !state) {
      throw new ValidationError('Missing code or state from Slack');
    }
    const parsed = this.verifyState(state);
    const redirectUri = this.redirectUri();
    const exchange = await this.slackApi.exchangeOauthCode(code, redirectUri);
    if (!exchange.ok || !exchange.access_token || !exchange.team?.id) {
      this.logger.error({ err: exchange.error }, 'Slack OAuth exchange failed');
      res.redirect(303, `${this.env.APP_URL}/settings/slack?error=oauth_failed`);
      return;
    }

    await this.connections.upsertInstall({
      operatorId: parsed.operator_id,
      installedByUserId: req.headers['x-user-id'] as string | undefined ?? parsed.operator_id, // best-effort
      teamId: exchange.team.id,
      teamName: exchange.team.name ?? null,
      botToken: exchange.access_token,
      scopes: (exchange.scope ?? '').split(',').filter(Boolean),
      defaultChannelId: exchange.incoming_webhook?.channel_id ?? null,
      defaultChannelName: exchange.incoming_webhook?.channel ?? null,
    });

    res.redirect(303, `${this.env.APP_URL}/settings/slack?ok=1`);
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private redirectUri(): string {
    // Operators install via the app's *public* API URL — this must match the
    // entry the Slack app's manifest declares as a redirect URL.
    return `${this.env.API_URL}/webhooks/slack/oauth/callback`;
  }

  private requireSlackCreds(): void {
    if (!this.env.SLACK_CLIENT_ID || !this.env.SLACK_CLIENT_SECRET || !this.env.SLACK_SIGNING_SECRET) {
      throw new AppError({
        code: 'slack.no_credentials',
        status: 500,
        detail: 'Slack integration is not configured (SLACK_CLIENT_ID/SECRET/SIGNING_SECRET)',
      });
    }
  }

  /** State HMAC keeps Slack from being able to forge a callback for some other operator. */
  private signState(payload: { operator_id: string; nonce: string }): string {
    const json = JSON.stringify(payload);
    const sig = createHmac('sha256', this.env.SLACK_SIGNING_SECRET!).update(json).digest('hex');
    return Buffer.from(`${json}.${sig}`, 'utf8').toString('base64url');
  }

  private verifyState(state: string): { operator_id: string; nonce: string } {
    let raw: string;
    try {
      raw = Buffer.from(state, 'base64url').toString('utf8');
    } catch {
      throw new UnauthorizedError('Malformed Slack OAuth state');
    }
    const idx = raw.lastIndexOf('.');
    if (idx < 0) throw new UnauthorizedError('Malformed Slack OAuth state');
    const json = raw.slice(0, idx);
    const sig = raw.slice(idx + 1);
    const expected = createHmac('sha256', this.env.SLACK_SIGNING_SECRET!).update(json).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedError('Bad Slack OAuth state signature');
    }
    try {
      return JSON.parse(json) as { operator_id: string; nonce: string };
    } catch {
      throw new UnauthorizedError('State payload is not JSON');
    }
  }

  private async requireOperatorByUserId(userId: string): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new AppError({
        code: 'operator.not_found',
        status: 404,
        detail: 'No operator profile for this user',
      });
    }
    return data;
  }
}

function cryptoRandomHex(bytes: number): string {
  // Cheap — sufficient nonce for state binding; not used as a secret on its own.
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) buf[i] = Math.floor(Math.random() * 256);
  return buf.toString('hex');
}
