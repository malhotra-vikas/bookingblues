import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';
import type { Json } from '@bookingblues/db-types';

import { AppError, WebhookSignatureError } from '../../common/errors/app-error';
import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';
import { dispatchPlatformEvent } from './stripe-event-handlers';

@Controller('webhooks/stripe')
@SkipThrottle()
export class StripePlatformController {
  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StripePlatformController.name);
  }

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!req.rawBody) {
      throw new AppError({
        code: 'webhook.no_raw_body',
        status: 500,
        detail: 'Raw body not available on request — check rawBody:true in NestFactory',
      });
    }
    if (!signature) throw new WebhookSignatureError('stripe');

    let event: Stripe.Event;
    try {
      event = this.stripe.verifyPlatformWebhook(req.rawBody, signature);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Stripe platform webhook signature failed');
      throw new WebhookSignatureError('stripe');
    }

    const recordResult = await this.idempotency.record({
      source: 'stripe',
      eventId: event.id,
      payload: event as unknown as Json,
      signatureVerified: true,
    });
    if (recordResult.status === 'duplicate') return { received: true };

    try {
      await dispatchPlatformEvent(event, {
        db: this.supabase.db(),
        logger: this.logger,
      });
      await this.idempotency.markProcessed(recordResult.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.idempotency.markFailed(recordResult.id, message);
      // Re-throw so Stripe retries this delivery.
      throw err;
    }
    return { received: true };
  }
}
