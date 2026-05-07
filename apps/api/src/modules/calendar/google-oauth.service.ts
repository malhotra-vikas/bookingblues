import { Inject, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

import { AppError } from '../../common/errors/app-error';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

@Injectable()
export class GoogleOAuthService {
  private readonly client: OAuth2Client | null;

  constructor(@Inject(ENV_TOKEN) private readonly env: Env) {
    if (
      !env.GOOGLE_OAUTH_CLIENT_ID ||
      !env.GOOGLE_OAUTH_CLIENT_SECRET ||
      !env.GOOGLE_OAUTH_REDIRECT_URI
    ) {
      this.client = null;
      return;
    }
    this.client = new OAuth2Client({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    });
  }

  authUrl(state: string): string {
    return this.requireClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // forces refresh_token return on every connect
      scope: SCOPES,
      state,
    });
  }

  async exchangeCode(code: string): Promise<{
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: Date;
    grantedScopes: ReadonlyArray<string>;
    email: string | null;
  }> {
    const client = this.requireClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new AppError({
        code: 'google.no_refresh_token',
        status: 400,
        detail:
          'Google did not return a refresh_token — likely a re-consent without prompt=consent',
      });
    }
    if (!tokens.access_token) {
      throw new AppError({
        code: 'google.no_access_token',
        status: 502,
        detail: 'Google did not return an access_token',
      });
    }

    let email: string | null = null;
    if (tokens.id_token) {
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: this.env.GOOGLE_OAUTH_CLIENT_ID!,
        });
        email = ticket.getPayload()?.email ?? null;
      } catch {
        // Non-fatal — we'll still store the connection without an email.
      }
    }

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000),
      grantedScopes: (tokens.scope ?? '').split(' ').filter(Boolean),
      email,
    };
  }

  /**
   * Refresh an access token using a stored refresh token. Returns the new
   * access token + expiry. Caller is responsible for catching 401-equivalent
   * errors and marking the connection revoked.
   */
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: Date }> {
    const client = this.requireClient();
    client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new AppError({
        code: 'google.refresh_failed',
        status: 502,
        detail: 'Google did not return a new access_token on refresh',
      });
    }
    return {
      accessToken: credentials.access_token,
      expiresAt: new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000),
    };
  }

  private requireClient(): OAuth2Client {
    if (!this.client) {
      throw new AppError({
        code: 'google.no_credentials',
        status: 500,
        detail:
          'Google OAuth requires GOOGLE_OAUTH_CLIENT_ID, _SECRET, and _REDIRECT_URI.',
      });
    }
    return this.client;
  }
}
