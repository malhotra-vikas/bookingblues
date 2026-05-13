import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/**
 * Per-conversation debounce wrapper around AdvanceService.advance.
 *
 * Why this exists: callers regularly send 2-4 SMS in rapid succession
 * ("I need a plumber" / "kitchen flood" / "08820 zip"). Each Twilio webhook
 * fires an independent advance loop, which means:
 *   - Concurrent OpenAI calls on the same conversation, with slightly
 *     diverging histories, producing 2-4 bot replies in quick succession.
 *   - The §9.3 8s outbound-SMS rate limit silently drops the second/third
 *     reply.
 *   - Duplicate tool calls (book_appointment, request_payment_link, etc.)
 *     that the DB unique index *mostly* catches — but for different slots
 *     it doesn't.
 *
 * The scheduler waits DEBOUNCE_MS after the latest caller message before
 * actually running advance. New caller messages within the window reset
 * the timer, so a 3-message burst collapses into one advance run that
 * reads all three turns from history.
 *
 * Single-replica only for MVP. When we scale beyond 1 api replica, switch
 * to a pg-boss queue keyed on conversation_id (or a Postgres advisory lock).
 * CLAUDE.md §6 already plans pg-boss for v2.
 */
// 3s instead of 2s. The 2s window was tight: real-world Twilio webhook
// arrival jitter (carrier delays, multi-hop) plus the bot's own outbound
// SMS round-trip occasionally put consecutive caller messages just outside
// the window, causing two advances. 3s collapses ~all human bursts (typing
// a follow-up after the first send is rarely <3s) while staying fast
// enough that the bot still feels responsive.
const DEBOUNCE_MS = 3_000;

@Injectable()
export class AdvanceSchedulerService {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AdvanceSchedulerService.name);
  }

  /**
   * Schedule (or reschedule) an advance for the given conversation.
   * If a timer is already pending, it's cleared so the burst collapses
   * into one run.
   */
  schedule(conversationId: string, run: () => Promise<void>): void {
    const existing = this.timers.get(conversationId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(conversationId);
      run().catch((err) => {
        this.logger.error(
          { conversationId, err: (err as Error).message },
          'debounced advance failed',
        );
      });
    }, DEBOUNCE_MS);
    this.timers.set(conversationId, timer);
  }
}
