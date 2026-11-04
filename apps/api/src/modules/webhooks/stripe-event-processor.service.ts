import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';

import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { BookingsService } from '../appointments/bookings.service';
import { type PlanAndCadence, buildPricePlanMap } from '../billing/plan-pricing';
import { UsageBillingService } from '../usage/usage-billing.service';
import { dispatchConnectEvent } from './stripe-connect-event-handlers';
import { dispatchPlatformEvent } from './stripe-event-handlers';

/**
 * Runs a verified Stripe event through its handlers. Shared by the two webhook
 * controllers and WebhookReplayService so a retry runs exactly the same code.
 *
 * On a retry (attempt > 1) the event can be hours old and newer events may
 * already have been applied, so state-carrying objects are re-read from Stripe
 * first — replaying a stale snapshot would roll the operator's state back.
 */
@Injectable()
export class StripeEventProcessor {
  private readonly priceMap: ReadonlyMap<string, PlanAndCadence>;

  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    private readonly usageBilling: UsageBillingService,
    private readonly bookings: BookingsService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) env: Env,
  ) {
    this.logger.setContext(StripeEventProcessor.name);
    this.priceMap = buildPricePlanMap(env);
  }

  async processPlatform(event: Stripe.Event, attempt: number): Promise<void> {
    const current = attempt > 1 ? await this.refreshPlatform(event) : event;
    if (!current) return;
    await dispatchPlatformEvent(current, {
      db: this.supabase.db(),
      logger: this.logger,
      priceMap: this.priceMap,
      billing: this.usageBilling,
    });
  }

  async processConnect(event: Stripe.Event, accountId: string, attempt: number): Promise<void> {
    const current = attempt > 1 ? await this.refreshConnect(event, accountId) : event;
    await dispatchConnectEvent(current, accountId, {
      db: this.supabase.db(),
      logger: this.logger,
      confirmPaidBooking: (appointmentId) => this.bookings.confirmPaidBooking(appointmentId),
    });
  }

  /** Latest Stripe state for a retried platform event, or null when it no longer applies. */
  private async refreshPlatform(event: Stripe.Event): Promise<Stripe.Event | null> {
    const stripe = this.stripe.client();
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const live = await stripe.subscriptions.retrieve(event.data.object.id);
        return withObject(event, live);
      }
      case 'invoice.payment_failed': {
        const id = event.data.object.id;
        if (!id) return event;
        const live = await stripe.invoices.retrieve(id);
        // Paid (or voided) since — pausing the operator now would be wrong.
        if (live.status === 'paid' || live.status === 'void') {
          this.logger.info({ eventId: event.id, invoiceId: id, status: live.status }, 'Stale payment_failed retry skipped');
          return null;
        }
        return event;
      }
      default:
        // Terminal facts (checkout completed, invoice created/paid, sub deleted)
        // are still true later; their handlers are idempotent.
        return event;
    }
  }

  private async refreshConnect(event: Stripe.Event, accountId: string): Promise<Stripe.Event> {
    if (event.type !== 'account.updated') return event;
    const live = await this.stripe.client().accounts.retrieve(accountId);
    return withObject(event, live);
  }
}

function withObject(event: Stripe.Event, object: unknown): Stripe.Event {
  return { ...event, data: { ...event.data, object } } as Stripe.Event;
}
