import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';
import type { Json } from '@bookingblues/db-types';

import { AppError, WebhookInProgressError, WebhookSignatureError } from '../../common/errors/app-error';
import { StripeService } from '../../common/stripe/stripe.service';
import { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';
import { StripeEventProcessor } from './stripe-event-processor.service';

@Controller('webhooks/stripe')
@SkipThrottle()
export class StripePlatformController {
  constructor(
    private readonly stripe: StripeService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly processor: StripeEventProcessor,
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
    // Non-2xx so Stripe keeps retrying: a 200 here would end its retries even
    // if the worker holding the claim then fails.
    if (recordResult.status === 'in_progress') throw new WebhookInProgressError('stripe', event.id);

    try {
      await this.processor.processPlatform(event, recordResult.attempt);
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
