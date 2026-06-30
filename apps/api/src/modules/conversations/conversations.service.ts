import { Injectable } from '@nestjs/common';
import type { Database, Tables } from '@bookingblues/db-types';

import { SupabaseService } from '../../common/supabase/supabase.service';

type ConversationRow = Tables<'conversations'>;
type MessageRole = Database['public']['Enums']['message_role'];

/**
 * Statuses that mean the conversation is done — `getOrCreate` will start a
 * fresh row when a caller texts in this state.
 *
 * `escalated` is intentionally NOT here. Per ADR 0010 amendment + CLAUDE.md
 * §12, escalated is non-terminal: a human is mid-conversation with the
 * caller via the Slack thread. The next caller SMS must land on the SAME
 * conversation row (and thus the SAME `#convos` thread); otherwise the
 * agent's replies route to one conversation while the caller's new messages
 * spawn a fresh thread, which is exactly the "new conversation shows up
 * while it is the same thread" bug we hit in QA.
 */
const TERMINAL_STATUSES: ReadonlyArray<Database['public']['Enums']['conversation_status']> = [
  'completed',
  'abandoned',
];

// A caller who texts within this window of a `completed` conversation is
// almost certainly following up ("how much?", "can I move my time?") — we
// reopen the prior convo instead of starting fresh. Keeps Slack thread +
// AI context continuous so the bot doesn't re-vet (CLAUDE.md §12 / QA
// 2026-05-13). Outside the window, treat as a brand-new job request.
const RESUME_COMPLETED_WINDOW_MS = 60 * 60 * 1000;

@Injectable()
export class ConversationsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Returns the operator's active conversation with this caller, or creates a
   * new one. "Active" means status NOT IN (completed/abandoned/escalated).
   * Slice 5 only writes the default `awaiting_bot` status; Slice 7 owns the
   * full state machine (CLAUDE.md §12).
   */
  async getOrCreate(
    operatorId: string,
    callerPhoneE164: string,
    opts: { resumeCompleted?: boolean } = {},
  ): Promise<ConversationRow> {
    // A bare inbound SMS shortly after a booking is almost always a follow-up,
    // so we reopen the just-completed conversation (resume window below). But a
    // new *phone call* is an unambiguous new job: the caller dialed in again and
    // got a fresh greeting. Reopening their completed convo there is the bug the
    // operator saw ("called again about a new issue, the old conversation
    // restarted"). The voice path passes `resumeCompleted: false`.
    const { resumeCompleted = true } = opts;
    const { data: existing, error: lookupErr } = await this.supabase
      .db()
      .from('conversations')
      .select('*')
      .eq('operator_id', operatorId)
      .eq('caller_phone_e164', callerPhoneE164)
      .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (existing) return existing;

    // Resume-recent-completed window: a follow-up SMS shortly after a booking
    // ("can I get an estimate?") used to spawn a fresh convo with a fresh
    // #convos thread, and the bot would restart vetting from scratch. If the
    // last terminal convo for this (operator, caller) ended within 60min,
    // reopen it so transcript + Slack thread stay continuous.
    if (!resumeCompleted) {
      return this.create(operatorId, callerPhoneE164);
    }

    const cutoffIso = new Date(Date.now() - RESUME_COMPLETED_WINDOW_MS).toISOString();
    const { data: recent } = await this.supabase
      .db()
      .from('conversations')
      .select('*')
      .eq('operator_id', operatorId)
      .eq('caller_phone_e164', callerPhoneE164)
      .in('status', [...TERMINAL_STATUSES])
      .gte('last_message_at', cutoffIso)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) {
      const { data: reopened, error: reopenErr } = await this.supabase
        .db()
        .from('conversations')
        // Reset `started_at` so the §9.3 caller-turn cap counts only THIS
        // follow-up engagement, not the turns from the prior (completed) one.
        .update({
          status: 'awaiting_bot',
          completed_at: null,
          outcome: null,
          started_at: new Date().toISOString(),
        })
        .eq('id', recent.id)
        .select('*')
        .single();
      if (reopenErr) throw reopenErr;
      return reopened;
    }

    return this.create(operatorId, callerPhoneE164);
  }

  private async create(operatorId: string, callerPhoneE164: string): Promise<ConversationRow> {
    const { data: created, error: insertErr } = await this.supabase
      .db()
      .from('conversations')
      .insert({
        operator_id: operatorId,
        caller_phone_e164: callerPhoneE164,
      })
      .select('*')
      .single();
    if (insertErr) throw insertErr;
    return created;
  }

  async appendMessage(args: {
    conversationId: string;
    role: MessageRole;
    body: string;
    twilioMessageSid?: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .db()
      .from('messages')
      .insert({
        conversation_id: args.conversationId,
        role: args.role,
        body: args.body,
        ...(args.twilioMessageSid ? { twilio_message_sid: args.twilioMessageSid } : {}),
      });
    if (error) throw error;

    // Bump last_message_at on the conversation.
    const { error: bumpErr } = await this.supabase
      .db()
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', args.conversationId);
    if (bumpErr) throw bumpErr;
  }

  /**
   * Auto-close conversations idle for `idleHours` so they don't linger
   * (the post-booking flow leaves a conversation in `awaiting_caller` to collect
   * the address — if the caller goes quiet it would otherwise stay open forever).
   * Escalated conversations are LEFT ALONE — a human owns them (§12). A
   * conversation with a confirmed appointment closes as completed/booked;
   * otherwise abandoned/timeout. Driven by an internal cron (same pattern as the
   * booking-holds sweeper).
   */
  async closeStale(idleHours = 24): Promise<{ closed: number }> {
    const cutoffIso = new Date(Date.now() - idleHours * 3_600_000).toISOString();
    const OPEN = ['active', 'awaiting_caller', 'awaiting_bot'] as const;
    const { data: stale, error } = await this.supabase
      .db()
      .from('conversations')
      .select('id')
      .in('status', OPEN as unknown as string[])
      .lt('last_message_at', cutoffIso)
      .limit(200);
    if (error) throw error;
    if (!stale || stale.length === 0) return { closed: 0 };

    let closed = 0;
    for (const c of stale) {
      const { data: appts } = await this.supabase
        .db()
        .from('appointments')
        .select('service_address')
        .eq('conversation_id', c.id)
        .eq('status', 'confirmed');
      const booked = (appts ?? []).length > 0;

      // CRITICAL: never close a booked conversation that's still missing the
      // service address — keep it open so the address can still be collected
      // (caller reply, or the operator's manual "Mark resolved + add address").
      const bookedButNoAddress = booked && (appts ?? []).every((a) => !a.service_address);
      if (bookedButNoAddress) continue;

      const { error: updErr } = await this.supabase
        .db()
        .from('conversations')
        .update({
          status: booked ? 'completed' : 'abandoned',
          completed_at: new Date().toISOString(),
          outcome: booked ? 'booked' : 'timeout',
        })
        .eq('id', c.id)
        .in('status', OPEN as unknown as string[]); // guard against a concurrent reopen
      if (!updErr) closed += 1;
    }
    return { closed };
  }
}
