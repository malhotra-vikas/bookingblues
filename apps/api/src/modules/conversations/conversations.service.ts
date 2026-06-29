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
  async getOrCreate(operatorId: string, callerPhoneE164: string): Promise<ConversationRow> {
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
}
