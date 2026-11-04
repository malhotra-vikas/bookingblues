import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';

import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  WEBHOOK_CLAIM_LEASE_SECONDS,
  WebhookIdempotencyService,
} from '../../common/webhooks/webhook-idempotency.service';
import { StripeEventProcessor } from './stripe-event-processor.service';

/** Sources whose stored payload is a complete, signature-verified event we can re-run. */
const REPLAYABLE_SOURCES = ['stripe', 'stripe_connect'] as const;
type ReplayableSource = (typeof REPLAYABLE_SOURCES)[number];

const BATCH_SIZE = 100;
/** Leave a fresh delivery to the request that's handling it. */
const MIN_AGE_MS = 2 * 60_000;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 6 * 60 * 60_000;
/** From this attempt on, every failure is logged at error level (→ Sentry). */
const ALERT_FROM_ATTEMPT = 5;

/** Wait before retrying an event that has failed `attempts` times: 1m, 2m, 4m … capped at 6h. */
export function replayBackoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

export interface ReplayResult {
  readonly scanned: number;
  readonly replayed: number;
  readonly failed: number;
}

/**
 * Re-runs Stripe webhook events that were recorded but never processed (handler
 * threw, or the process died mid-way). Stripe gives up after ~3 days of
 * retries; this keeps going, with exponential backoff, until the event
 * succeeds — so a failure is never silently dropped. Each run is claim-guarded,
 * so it can't race a live Stripe retry of the same event.
 *
 * Triggered by the cron endpoint POST /v1/internal/webhooks/replay.
 */
@Injectable()
export class WebhookReplayService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly processor: StripeEventProcessor,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookReplayService.name);
  }

  async replayUnprocessed(now = new Date()): Promise<ReplayResult> {
    const leaseCutoff = new Date(now.getTime() - WEBHOOK_CLAIM_LEASE_SECONDS * 1000).toISOString();
    const ageCutoff = new Date(now.getTime() - MIN_AGE_MS).toISOString();
    const { data, error } = await this.supabase
      .db()
      .from('webhook_events')
      .select('id, source, event_id, payload, attempts, updated_at')
      .in('source', [...REPLAYABLE_SOURCES])
      .is('processed_at', null)
      .lt('claimed_at', leaseCutoff)
      .lt('created_at', ageCutoff)
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);
    if (error) throw error;

    let replayed = 0;
    let failed = 0;
    for (const row of data ?? []) {
      if (now.getTime() - new Date(row.updated_at).getTime() < replayBackoffMs(row.attempts)) continue;
      const source = row.source as ReplayableSource;
      const claim = await this.idempotency.claim(source, row.event_id);
      if (claim.status !== 'new') continue;

      const event = row.payload as unknown as Stripe.Event;
      try {
        if (source === 'stripe') {
          await this.processor.processPlatform(event, claim.attempt);
        } else {
          if (!event.account) throw new Error('Connect event payload has no account');
          await this.processor.processConnect(event, event.account, claim.attempt);
        }
        await this.idempotency.markProcessed(claim.id);
        replayed += 1;
        this.logger.info({ source, eventId: row.event_id, attempt: claim.attempt }, 'webhook replay succeeded');
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        await this.idempotency.markFailed(claim.id, message);
        const ctx = { source, eventId: row.event_id, eventType: event.type, attempt: claim.attempt, err: message };
        if (claim.attempt >= ALERT_FROM_ATTEMPT) {
          this.logger.error(ctx, 'webhook replay keeps failing — needs a human');
        } else {
          this.logger.warn(ctx, 'webhook replay failed; will retry');
        }
      }
    }
    return { scanned: data?.length ?? 0, replayed, failed };
  }
}
