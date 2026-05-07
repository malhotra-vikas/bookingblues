import { Injectable } from '@nestjs/common';
import type { Database, Tables } from '@bookingblues/db-types';

import { SupabaseService } from '../../common/supabase/supabase.service';

type ConversationRow = Tables<'conversations'>;
type MessageRole = Database['public']['Enums']['message_role'];

const TERMINAL_STATUSES: ReadonlyArray<Database['public']['Enums']['conversation_status']> = [
  'completed',
  'abandoned',
  'escalated',
];

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
