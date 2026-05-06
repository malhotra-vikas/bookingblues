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
 *   2. Call `record(...)`. If `status === 'duplicate'`, the side effect was
 *      already applied on a prior delivery → short-circuit with 200 OK.
 *   3. If `status === 'new'`, apply side effects, then call `markProcessed`.
 *      If side effects fail, call `markFailed` so retries can pick it up.
 *
 * The DB-level `unique (source, event_id)` constraint is the source of truth.
 */
export type WebhookSource = 'twilio' | 'stripe' | 'stripe_connect' | 'google';

export interface RecordArgs {
  readonly source: WebhookSource;
  readonly eventId: string;
  readonly payload: Json;
  readonly signatureVerified: boolean;
}

export type RecordResult =
  | { readonly status: 'new'; readonly id: string }
  | { readonly status: 'duplicate' };

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
   * Insert a webhook event row. Returns 'duplicate' iff the unique constraint
   * fires — that's the canonical signal that the event has been delivered before.
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
      if (error.code === PG_UNIQUE_VIOLATION) {
        this.logger.info(
          { source: args.source, eventId: args.eventId },
          'Webhook event already recorded; skipping side effects',
        );
        return { status: 'duplicate' };
      }
      throw new ExternalServiceError(
        'supabase',
        `Failed to record webhook event (${args.source}/${args.eventId})`,
        error,
      );
    }

    return { status: 'new', id: data.id };
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

  /** Stamp an error message on the event so retries (or ops) can investigate. */
  async markFailed(id: string, message: string): Promise<void> {
    const { error } = await this.supabase
      .db()
      .from('webhook_events')
      .update({ error: message })
      .eq('id', id);
    if (error) {
      throw new ExternalServiceError('supabase', 'Failed to mark webhook failure', error);
    }
  }
}
