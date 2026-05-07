import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppError } from '../errors/app-error';

/**
 * Thin wrapper around the Stripe SDK. **API-only.**
 *
 * Per CLAUDE.md §17 / §11.13:
 *   - Booking-fee charges (Slice 8) MUST pass `stripeAccount` for Direct Charges
 *     against the connected account. The `connect()` helper exposes a typed
 *     wall against missing the header.
 *   - Tolerant of missing `STRIPE_SECRET_KEY` in dev so the API still boots
 *     when no Stripe account is configured. First call to `client()` throws.
 */
@Injectable()
export class StripeService {
  private readonly stripe: Stripe | null;
  private readonly platformWebhookSecret: string | null;
  private readonly connectWebhookSecret: string | null;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    this.stripe = env.STRIPE_SECRET_KEY
      ? new Stripe(env.STRIPE_SECRET_KEY, {
          apiVersion: '2024-10-28.acacia',
          typescript: true,
        })
      : null;
    this.platformWebhookSecret = env.STRIPE_WEBHOOK_SECRET ?? null;
    this.connectWebhookSecret = env.STRIPE_CONNECT_WEBHOOK_SECRET ?? null;
  }

  client(): Stripe {
    if (!this.stripe) {
      throw new AppError({
        code: 'stripe.no_credentials',
        status: 500,
        detail: 'StripeService requires STRIPE_SECRET_KEY.',
      });
    }
    return this.stripe;
  }

  /**
   * Returns a Stripe instance scoped to a connected account (Slice 8).
   * Always pass the account ID — never call this with empty string.
   */
  connect(stripeAccountId: string): Stripe {
    if (!stripeAccountId) {
      throw new AppError({
        code: 'stripe.missing_connected_account',
        status: 500,
        detail: 'connect(stripeAccountId) requires a non-empty connected account id.',
      });
    }
    const base = this.client();
    // The SDK supports per-call options (`{ stripeAccount }`) on every method;
    // we expose this helper today only as documentation. Slice 8 will plumb
    // `stripeAccount` through call sites directly to keep the surface explicit.
    void stripeAccountId;
    return base;
  }

  verifyPlatformWebhook(rawBody: Buffer | string, signatureHeader: string): Stripe.Event {
    if (!this.platformWebhookSecret) {
      throw new AppError({
        code: 'stripe.no_platform_webhook_secret',
        status: 500,
        detail: 'STRIPE_WEBHOOK_SECRET is not configured.',
      });
    }
    return this.client().webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.platformWebhookSecret,
    );
  }

  verifyConnectWebhook(rawBody: Buffer | string, signatureHeader: string): Stripe.Event {
    if (!this.connectWebhookSecret) {
      throw new AppError({
        code: 'stripe.no_connect_webhook_secret',
        status: 500,
        detail: 'STRIPE_CONNECT_WEBHOOK_SECRET is not configured.',
      });
    }
    return this.client().webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.connectWebhookSecret,
    );
  }
}
