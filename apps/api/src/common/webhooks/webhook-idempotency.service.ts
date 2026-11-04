import { Injectable } from '@nestjs/common';
import type { Json } from '@bookingblues/db-types';
import { PinoLogger } from 'nestjs-pino';

import { ExternalServiceError } from '../errors/app-error';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Per CLAUDE.md §11.2: every webhook handler MUST be idempotent.
 *
 * Pattern:
 *   1. Verify signature (caller's responsibility — done before recording).
 *   2. Call `record(...)`:
 *      - 'new'         → first delivery, or a retry of one that never finished.
 *                        Apply side effects, then `markProcessed`; on failure
 *                        `markFailed` (releases the claim) and return non-2xx so
 *                        the sender retries.
 *      - 'duplicate'   → already processed → 200 OK, no side effects.
 *      - 'in_progress' → another worker holds a live claim. Senders that retry
 *                        (Stripe) must get a non-2xx, or a 200 here would end
 *                        their retries while that worker might still fail.
 *   3. Unprocessed Stripe events are also replayed by WebhookReplayService, so a
 *      failure is retried even after the sender gives up.
 *
 * The DB-level `unique (source, event_id)` constraint is the source of truth.
 */
export type WebhookSource = 'twilio' | 'stripe' | 'stripe_connect' | 'google';

/**
 * How long a claim protects an in-flight handler from a concurrent retry. A
 * crashed worker's event becomes re-claimable after this.
 */
export const WEBHOOK_CLAIM_LEASE_SECONDS = 300;

/** Far-past claim time: a failed event is re-claimable immediately. */
const RELEASED_CLAIM_AT = new Date(0).toISOString();

export interface RecordArgs {
  readonly source: WebhookSource;
  readonly eventId: string;
  readonly payload: Json;
  readonly signatureVerified: boolean;
}

export type RecordResult =
  /** `attempt` is 1 on first delivery, >1 when re-claiming a failed/abandoned one. */
  | { readonly status: 'new'; readonly id: string; readonly attempt: number }
  | { readonly status: 'duplicate' }
  | { readonly status: 'in_progress' };

const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class WebhookIdempotencyService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookIdempotencyService.name);
  }

  /**
   * Insert a webhook event row. If it already exists (unique constraint), try
   * to re-claim it: an unprocessed event whose claim has lapsed is handed back
   * as 'new' so the retry actually runs the side effects.
   */
  async record(args: RecordArgs): Promise<RecordResult> {
    const { data, error } = await this.supabase
      .db()
      .from('webhook_events')
      .insert({
        source: args.source,
        event_id: args.eventId,
        signature_verified: args.signatureVerified,
        payload: args.payload,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) return this.claim(args.source, args.eventId);
      throw new ExternalServiceError(
        'supabase',
        `Failed to record webhook event (${args.source}/${args.eventId})`,
        error,
      );
    }

    return { status: 'new', id: data.id, attempt: 1 };
  }

  /** Atomically re-claim an already-recorded event (see claim_webhook_event). */
  async claim(source: WebhookSource, eventId: string): Promise<RecordResult> {
    const { data, error } = await this.supabase.db().rpc('claim_webhook_event', {
      p_source: source,
      p_event_id: eventId,
      p_lease_seconds: WEBHOOK_CLAIM_LEASE_SECONDS,
    });
    if (error) {
      throw new ExternalServiceError('supabase', `Failed to claim webhook event (${source}/${eventId})`, error);
    }
    const row = data?.[0];
    if (!row) {
      throw new ExternalServiceError('supabase', `Webhook event vanished while claiming (${source}/${eventId})`);
    }
    if (row.outcome === 'reclaimed') {
      this.logger.warn({ source, eventId, attempt: row.attempts }, 'Re-processing a previously failed webhook event');
      return { status: 'new', id: row.id, attempt: row.attempts };
    }
    if (row.outcome === 'processed') {
      this.logger.info({ source, eventId }, 'Webhook event already processed; skipping side effects');
      return { status: 'duplicate' };
    }
    this.logger.info({ source, eventId }, 'Webhook event is being processed by another worker');
    return { status: 'in_progress' };
  }

  /** Mark a previously-recorded event as successfully processed. */
  async markProcessed(id: string): Promise<void> {
    const { error } = await this.supabase
      .db()
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq('id', id);
    if (error) {
      throw new ExternalServiceError('supabase', 'Failed to mark webhook processed', error);
    }
  }

  /**
   * Stamp the error and release the claim, so the sender's next retry (or the
   * replay sweeper) re-processes the event instead of skipping it.
   */
  async markFailed(id: string, message: string): Promise<void> {
    const { error } = await this.supabase
      .db()
      .from('webhook_events')
      .update({ error: message, claimed_at: RELEASED_CLAIM_AT })
      .eq('id', id);
    if (error) {
      throw new ExternalServiceError('supabase', 'Failed to mark webhook failure', error);
    }
  }
}
