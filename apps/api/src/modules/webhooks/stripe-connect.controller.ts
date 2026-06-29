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
import { BookingsService } from '../appointments/bookings.service';
import { dispatchConnectEvent } from './stripe-connect-event-handlers';

@Controller('webhooks/stripe/connect')
@SkipThrottle()
export class StripeConnectController {
  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly bookings: BookingsService,
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

    try {
      await dispatchConnectEvent(event, event.account, {
        db: this.supabase.db(),
        logger: this.logger,
        confirmPaidBooking: (appointmentId) => this.bookings.confirmPaidBooking(appointmentId),
      });
      await this.idempotency.markProcessed(recorded.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.idempotency.markFailed(recorded.id, msg);
      throw err;
    }
    return { received: true };
  }
}
