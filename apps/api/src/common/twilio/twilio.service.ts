import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import twilio from 'twilio';
import type { Twilio } from 'twilio';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppError, ExternalServiceError } from '../errors/app-error';

/**
 * Thin wrapper around the Twilio SDK. **API-only.** Per CLAUDE.md §11.1 (signature
 * validation) and §11.12 (outbound SMS allowlist for non-prod).
 *
 * Constructor is tolerant of missing credentials in dev so the API still boots.
 * First operation throws if creds are missing.
 */
@Injectable()
export class TwilioService {
  private readonly twilio: Twilio | null;
  private readonly authToken: string | null;
  private readonly allowlist: ReadonlySet<string>;
  private readonly isProd: boolean;

  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TwilioService.name);
    this.authToken = env.TWILIO_AUTH_TOKEN ?? null;
    this.twilio =
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
        ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
        : null;
    this.isProd = env.NODE_ENV === 'production';
    this.allowlist = new Set(
      (env.OUTBOUND_SMS_ALLOWLIST ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  client(): Twilio {
    if (!this.twilio) {
      throw new AppError({
        code: 'twilio.no_credentials',
        status: 500,
        detail: 'TwilioService requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
      });
    }
    return this.twilio;
  }

  /**
   * Verify a Twilio webhook signature.
   * `fullUrl` MUST include scheme + host + path + query string exactly as Twilio called.
   */
  validateSignature(args: {
    signatureHeader: string | undefined;
    fullUrl: string;
    formParams: Record<string, string>;
  }): boolean {
    if (!this.authToken) {
      throw new AppError({
        code: 'twilio.no_auth_token',
        status: 500,
        detail: 'TWILIO_AUTH_TOKEN is not configured.',
      });
    }
    if (!args.signatureHeader) return false;
    return twilio.validateRequest(
      this.authToken,
      args.signatureHeader,
      args.fullUrl,
      args.formParams,
    );
  }

  /**
   * Send an outbound SMS. Honors §11.12 allowlist outside production.
   * In non-prod, an unconfigured allowlist blocks ALL outbound SMS (fail-safe).
   */
  async sendSms(args: {
    from: string;
    to: string;
    body: string;
  }): Promise<{ sid: string } | { skipped: 'allowlist' }> {
    if (!this.isProd) {
      if (!this.allowlist.has(args.to)) {
        this.logger.warn(
          { to_last4: args.to.slice(-4), reason: 'not_on_allowlist' },
          'Outbound SMS blocked by non-prod allowlist',
        );
        return { skipped: 'allowlist' };
      }
    }
    // Tell Twilio to POST status transitions (queued → sent → delivered or
    // → failed/undelivered) to our webhook. Omitted if API_URL isn't a public
    // URL (dev without ngrok) — Twilio will reject localhost URLs anyway.
    const statusCallback = this.buildStatusCallbackUrl();

    try {
      const msg = await this.client().messages.create({
        from: args.from,
        to: args.to,
        body: args.body,
        ...(statusCallback ? { statusCallback } : {}),
      });
      return { sid: msg.sid };
    } catch (err) {
      throw new ExternalServiceError(
        'twilio',
        `Failed to send SMS to ${args.to.slice(-4)}`,
        err,
      );
    }
  }

  private buildStatusCallbackUrl(): string | null {
    const base = this.env.API_URL;
    if (!base) return null;
    // Twilio rejects localhost / private-IP callback URLs at message-create time.
    // Skip the param in dev so sendSms doesn't 400.
    if (/^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(base)) {
      return null;
    }
    return `${base.replace(/\/$/, '')}/webhooks/twilio/status`;
  }
}
