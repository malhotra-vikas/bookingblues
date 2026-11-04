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

@Controller('webhooks/stripe/connect')
@SkipThrottle()
export class StripeConnectController {
  constructor(
    private readonly stripe: StripeService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly processor: StripeEventProcessor,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StripeConnectController.name);
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
        detail: 'Raw body not available',
      });
    }
    if (!signature) throw new WebhookSignatureError('stripe_connect');

    let event: Stripe.Event;
    try {
      event = this.stripe.verifyConnectWebhook(req.rawBody, signature);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Stripe Connect webhook signature failed');
      throw new WebhookSignatureError('stripe_connect');
    }
    if (!event.account) {
      throw new WebhookSignatureError('stripe_connect');
    }

    const recorded = await this.idempotency.record({
      source: 'stripe_connect',
      eventId: event.id,
      payload: event as unknown as Json,
      signatureVerified: true,
    });
    if (recorded.status === 'duplicate') return { received: true };
    if (recorded.status === 'in_progress') throw new WebhookInProgressError('stripe_connect', event.id);

    try {
      await this.processor.processConnect(event, event.account, recorded.attempt);
      await this.idempotency.markProcessed(recorded.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.idempotency.markFailed(recorded.id, msg);
      throw err;
    }
    return { received: true };
  }
}
