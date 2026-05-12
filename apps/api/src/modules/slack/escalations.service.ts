import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Database, Tables } from '@bookingblues/db-types';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { AppError, NotFoundError } from '../../common/errors/app-error';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { ConversationsService } from '../conversations/conversations.service';

import { SlackApiClient } from './slack-api.client';

type EscalationReason =
  | 'bot_stuck'
  | 'caller_requested'
  | 'operator_forced'
  | 'calendar_revoked'
  | 'turn_cap';
type ConversationRow = Tables<'conversations'>;
type OperatorRow = Tables<'operators'>;

interface EscalationRow {
  id: string;
  operator_id: string;
  conversation_id: string;
  caller_phone_e164: string;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  status: 'open' | 'resolved' | 'abandoned';
  reason: EscalationReason;
  opened_by: 'bot' | 'caller' | 'operator';
}

const SMS_BRIDGE_MIN_GAP_MS = 8_000; // CLAUDE.md §9.3 — one outbound per 8s.

@Injectable()
export class EscalationsService {
  /** Tracks the last outbound SMS time per conversation, for the §9.3 rate limit. */
  private readonly lastSmsAt = new Map<string, number>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly slackApi: SlackApiClient,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly audit: AuditLogService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EscalationsService.name);
  }

  // ── opening + state transitions ─────────────────────────────────────────

  /**
   * Open or reuse an escalation for a conversation. Returns the escalation
   * row. Posts the parent Slack message + action buttons. If Slack isn't
   * configured / fails, falls back to email (Slice 10) and still flips the
   * conversation to `escalated` so the bot doesn't reply.
   */
  async openEscalation(args: {
    operator: OperatorRow;
    conversation: ConversationRow;
    callerPhoneE164: string;
    reason: EscalationReason;
    /** Free-form reason text from the AI (or the operator UI). Surfaced in
     *  the Slack post so the human sees the model's own explanation, not just
     *  the normalised enum bucket. */
    reasonText?: string;
    openedBy: 'bot' | 'caller' | 'operator';
    actorUserId?: string | null;
  }): Promise<{ escalation: EscalationRow; deliveredVia: 'slack' | 'email_fallback' | 'none' }> {
    // 1. Re-use any open escalation for this conversation.
    const existing = await this.findOpenForConversation(args.conversation.id);
    if (existing) {
      return { escalation: existing, deliveredVia: existing.slack_thread_ts ? 'slack' : 'none' };
    }

    // 2. Flip the conversation to 'escalated' first (idempotent for callers).
    await this.flipConversationStatus(args.conversation.id, 'escalated');

    // 3. Try Slack post; fall back to email if it fails or isn't configured.
    let deliveredVia: 'slack' | 'email_fallback' | 'none' = 'none';
    let channelId: string | null = null;
    let threadTs: string | null = null;

    const defaultChannel = this.slackApi.defaultChannelId();
    if (this.slackApi.isConfigured() && defaultChannel) {
      try {
        const transcript = await this.lastTurns(args.conversation.id, 10);
        const post = await this.slackApi.postMessage({
          channel: defaultChannel,
          text: this.parentMessageText(args, transcript),
          blocks: this.parentMessageBlocks(args, transcript),
        });
        if (post.ok && post.ts) {
          channelId = post.channel ?? defaultChannel;
          threadTs = post.ts;
          deliveredVia = 'slack';
        } else {
          this.logger.warn(
            { operatorId: args.operator.id, err: post.error },
            'Slack postMessage failed; falling back to email',
          );
          deliveredVia = 'email_fallback';
        }
      } catch (err) {
        this.logger.warn(
          { operatorId: args.operator.id, err: (err as Error).message },
          'Slack escalation post failed; falling back to email',
        );
        deliveredVia = 'email_fallback';
      }
    } else {
      // SLACK_BOT_TOKEN / SLACK_DEFAULT_CHANNEL_ID unset — email fallback when Slice 10 wires Resend.
      deliveredVia = 'email_fallback';
    }

    const escalation = await this.insertEscalation({
      operatorId: args.operator.id,
      conversationId: args.conversation.id,
      callerPhoneE164: args.callerPhoneE164,
      slackChannelId: channelId,
      slackThreadTs: threadTs,
      reason: args.reason,
      openedBy: args.openedBy,
      fallbackEmailSent: deliveredVia === 'email_fallback',
    });

    await this.audit.write({
      actorUserId: args.actorUserId ?? null,
      operatorId: args.operator.id,
      action: 'conversation.escalate',
      resourceType: 'conversation',
      resourceId: args.conversation.id,
      metadata: {
        reason: args.reason,
        opened_by: args.openedBy,
        delivered_via: deliveredVia,
      },
    });

    return { escalation, deliveredVia };
  }

  /**
   * Hand back to the AI without closing the escalation. Caller messages from
   * this point resume the advance loop, but the Slack thread stays open as a
   * control surface — agents can still intervene in-thread, mark spam, or
   * close. The escalation row only flips to `resolved` via explicit Close /
   * Mark spam / `/bb resolve` / `/bb close-spam`. The handoff note is durably
   * captured in the audit log even though it's not written to the row.
   */
  async backToBot(args: {
    escalationId: string;
    resolvedByUserId: string | null;
    note?: string;
  }): Promise<void> {
    const esc = await this.requireEscalation(args.escalationId);
    await this.flipConversationStatus(esc.conversation_id, 'awaiting_caller');

    await this.audit.write({
      actorUserId: args.resolvedByUserId,
      operatorId: esc.operator_id,
      action: 'escalation.back_to_bot',
      resourceType: 'escalation',
      resourceId: esc.id,
      metadata: { note: args.note ?? null },
    });
  }

  async resolveEscalation(args: {
    escalationId: string;
    resolvedByUserId: string | null;
    outcome: 'rejected' | 'spam' | 'booked';
    note?: string;
  }): Promise<void> {
    const esc = await this.requireEscalation(args.escalationId);
    await this.updateEscalation(esc.id, {
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: args.resolvedByUserId,
      resolution_note: args.note ?? null,
    });
    // Close the underlying conversation.
    const { error } = await this.supabase
      .db()
      .from('conversations')
      .update({
        status: 'completed',
        outcome: args.outcome,
        completed_at: new Date().toISOString(),
      })
      .eq('id', esc.conversation_id);
    if (error) throw error;

    await this.audit.write({
      actorUserId: args.resolvedByUserId,
      operatorId: esc.operator_id,
      action: 'escalation.resolve',
      resourceType: 'escalation',
      resourceId: esc.id,
      metadata: { outcome: args.outcome, note: args.note ?? null },
    });
  }

  // ── bridge: inbound caller SMS during escalation → Slack thread ────────

  async forwardCallerSmsToSlack(args: {
    operator: OperatorRow;
    conversation: ConversationRow;
    callerPhoneE164: string;
    body: string;
  }): Promise<void> {
    const esc = await this.findOpenForConversation(args.conversation.id);
    if (!esc?.slack_channel_id || !esc.slack_thread_ts) {
      // No Slack thread (email-fallback path). The conversation is escalated;
      // we still persist the caller message so the operator sees it on the dashboard.
      return;
    }
    try {
      const last4 = args.callerPhoneE164.slice(-4);
      const post = await this.slackApi.postMessage({
        channel: esc.slack_channel_id,
        threadTs: esc.slack_thread_ts,
        text: `📲 Caller (•••${last4}): ${args.body}`,
      });
      if (post.ts) {
        // Stamp the latest message row with the Slack ts so we have a back-reference.
        await this.supabase
          .db()
          .from('messages')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ slack_message_ts: post.ts } as any)
          .eq('conversation_id', args.conversation.id)
          .eq('role', 'caller')
          .order('created_at', { ascending: false })
          .limit(1);
      }
    } catch (err) {
      this.logger.error(
        { err: (err as Error).message, conversationId: args.conversation.id },
        'forwardCallerSmsToSlack failed',
      );
    }
  }

  // ── bridge: outbound Slack thread reply → SMS ──────────────────────────

  async forwardAgentReplyToSms(args: {
    channelId: string;
    threadTs: string;
    slackMessageTs: string;
    text: string;
    slackUserId: string;
  }): Promise<{ delivered: boolean; reason?: string }> {
    const esc = await this.findOpenByThread(args.channelId, args.threadTs);
    if (!esc) return { delivered: false, reason: 'no_open_escalation' };

    // §9.3 rate limit (8s/conversation outbound).
    const now = Date.now();
    const last = this.lastSmsAt.get(esc.conversation_id) ?? 0;
    if (now - last < SMS_BRIDGE_MIN_GAP_MS) {
      return { delivered: false, reason: 'rate_limited' };
    }

    const { data: op, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('twilio_number_e164')
      .eq('id', esc.operator_id)
      .maybeSingle();
    if (opErr) throw opErr;
    if (!op?.twilio_number_e164) {
      return { delivered: false, reason: 'no_operator_number' };
    }

    const send = await this.twilio.sendSms({
      from: op.twilio_number_e164,
      to: esc.caller_phone_e164,
      body: args.text,
    });
    if ('skipped' in send) return { delivered: false, reason: `skipped:${send.skipped}` };
    this.lastSmsAt.set(esc.conversation_id, now);

    // Persist as a system-role message so the transcript shows the operator's reply.
    await this.conversations.appendMessage({
      conversationId: esc.conversation_id,
      role: 'system',
      body: args.text,
      twilioMessageSid: send.sid,
    });
    // Stamp the slack ts for back-reference.
    await this.supabase
      .db()
      .from('messages')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ slack_message_ts: args.slackMessageTs } as any)
      .eq('twilio_message_sid', send.sid);

    return { delivered: true };
  }

  /**
   * Mirror the AI bot's outbound SMS into the open escalation's Slack
   * thread (if any). Lets the human in #hitl see both sides of the
   * conversation after Resume AI, so they can decide whether to re-engage.
   * Best-effort — any Slack failure is swallowed so the bot's SMS pipeline
   * is never blocked by Slack downtime.
   */
  async echoBotReplyToOpenEscalation(args: {
    conversationId: string;
    text: string;
  }): Promise<void> {
    try {
      const esc = await this.findOpenForConversation(args.conversationId);
      if (!esc?.slack_channel_id || !esc.slack_thread_ts) return;
      const body = args.text.length > 480 ? `${args.text.slice(0, 480)}…` : args.text;
      await this.slackApi.postMessage({
        channel: esc.slack_channel_id,
        threadTs: esc.slack_thread_ts,
        text: `🤖 Bot: ${body}`,
      });
    } catch (err) {
      this.logger.warn(
        { conversationId: args.conversationId, err: (err as Error).message },
        'echoBotReplyToOpenEscalation failed (non-fatal)',
      );
    }
  }

  /**
   * One-shot SMS to the caller in the context of a specific escalation —
   * used by the Resume-AI modal where we already know the escalation id and
   * don't need thread/channel routing. No §9.3 rate-limit gate (modal submit
   * is human-deliberate, not a stream).
   */
  async sendAgentSmsForEscalation(args: {
    escalationId: string;
    text: string;
  }): Promise<{ delivered: boolean; reason?: string }> {
    const esc = await this.requireEscalation(args.escalationId);

    const { data: op, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('twilio_number_e164')
      .eq('id', esc.operator_id)
      .maybeSingle();
    if (opErr) throw opErr;
    if (!op?.twilio_number_e164) return { delivered: false, reason: 'no_operator_number' };

    const send = await this.twilio.sendSms({
      from: op.twilio_number_e164,
      to: esc.caller_phone_e164,
      body: args.text,
    });
    if ('skipped' in send) return { delivered: false, reason: `skipped:${send.skipped}` };

    await this.conversations.appendMessage({
      conversationId: esc.conversation_id,
      role: 'system',
      body: args.text,
      twilioMessageSid: send.sid,
    });
    return { delivered: true };
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  async findOpenForConversation(conversationId: string): Promise<EscalationRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('escalations')
      .select(
        'id, operator_id, conversation_id, caller_phone_e164, slack_channel_id, slack_thread_ts, status, reason, opened_by',
      )
      .eq('conversation_id', conversationId)
      .eq('status', 'open')
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  async findOpenByThread(channelId: string, threadTs: string): Promise<EscalationRow | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('escalations')
      .select(
        'id, operator_id, conversation_id, caller_phone_e164, slack_channel_id, slack_thread_ts, status, reason, opened_by',
      )
      .eq('slack_channel_id', channelId)
      .eq('slack_thread_ts', threadTs)
      .eq('status', 'open')
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  private async requireEscalation(id: string): Promise<EscalationRow> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('escalations')
      .select(
        'id, operator_id, conversation_id, caller_phone_e164, slack_channel_id, slack_thread_ts, status, reason, opened_by',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundError('Escalation not found');
    return data;
  }

  private async insertEscalation(args: {
    operatorId: string;
    conversationId: string;
    callerPhoneE164: string;
    slackChannelId: string | null;
    slackThreadTs: string | null;
    reason: EscalationReason;
    openedBy: 'bot' | 'caller' | 'operator';
    fallbackEmailSent: boolean;
  }): Promise<EscalationRow> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('escalations')
      .insert({
        operator_id: args.operatorId,
        conversation_id: args.conversationId,
        caller_phone_e164: args.callerPhoneE164,
        slack_channel_id: args.slackChannelId,
        slack_thread_ts: args.slackThreadTs,
        reason: args.reason,
        opened_by: args.openedBy,
        fallback_email_sent_at: args.fallbackEmailSent ? new Date().toISOString() : null,
      })
      .select(
        'id, operator_id, conversation_id, caller_phone_e164, slack_channel_id, slack_thread_ts, status, reason, opened_by',
      )
      .single();
    if (error) {
      // The partial unique index can race; pick up the existing open escalation.
      if (error.code === '23505') {
        const existing = await this.findOpenForConversation(args.conversationId);
        if (existing) return existing;
      }
      throw error;
    }
    return data;
  }

  private async updateEscalation(
    id: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { error } = await client.from('escalations').update(patch).eq('id', id);
    if (error) throw error;
  }

  private async flipConversationStatus(
    conversationId: string,
    status: Database['public']['Enums']['conversation_status'],
  ): Promise<void> {
    const { error } = await this.supabase
      .db()
      .from('conversations')
      .update({ status })
      .eq('id', conversationId);
    if (error) throw error;
  }

  private async lastTurns(
    conversationId: string,
    n: number,
  ): Promise<Array<{ role: string; body: string }>> {
    const { data, error } = await this.supabase
      .db()
      .from('messages')
      .select('role, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(n);
    if (error) throw error;
    return (data ?? []).reverse().map((m) => ({ role: m.role, body: m.body }));
  }

  // ── Slack message formatting ───────────────────────────────────────────

  private parentMessageText(
    args: { operator: OperatorRow; conversation: ConversationRow; callerPhoneE164: string; reason: EscalationReason; reasonText?: string; openedBy: string },
    transcript: ReadonlyArray<{ role: string; body: string }>,
  ): string {
    const last4 = args.callerPhoneE164.slice(-4);
    const reasonHuman = {
      bot_stuck: 'Bot got stuck',
      caller_requested: 'Caller asked for a human',
      operator_forced: 'Operator forced from dashboard',
      calendar_revoked: 'Calendar access revoked',
      turn_cap: 'Conversation hit the turn cap',
    }[args.reason];

    const lines = [
      `:rotating_light: *Needs a human* — ${reasonHuman} (opened by ${args.openedBy})`,
      `${args.operator.business_name} · caller •••${last4} · convo \`${args.conversation.id.slice(0, 8)}\``,
      ...(args.reasonText ? ['', `*Why:* ${args.reasonText}`] : []),
      '',
      ...transcript.map((t) => {
        const tag = t.role === 'caller' ? '📲 Caller' : t.role === 'bot' ? '🤖 Bot' : '👤 Agent';
        const body = t.body.length > 280 ? `${t.body.slice(0, 280)}…` : t.body;
        return `${tag}: ${body}`;
      }),
      '',
      "_Reply in this thread to send an SMS to the caller. Use `/bb back-to-bot` to hand control back to the AI, `/bb resolve` to close, or `/bb show-number` to reveal the full caller number (audit-logged)._",
    ];
    return lines.join('\n');
  }

  private parentMessageBlocks(
    args: { operator: OperatorRow; conversation: ConversationRow; callerPhoneE164: string; reason: EscalationReason; reasonText?: string },
    transcript: ReadonlyArray<{ role: string; body: string }>,
  ): ReadonlyArray<unknown> {
    const last4 = args.callerPhoneE164.slice(-4);
    const transcriptText = transcript
      .map((t) => {
        const tag = t.role === 'caller' ? '📲' : t.role === 'bot' ? '🤖' : '👤';
        const body = t.body.length > 280 ? `${t.body.slice(0, 280)}…` : t.body;
        return `${tag} ${body}`;
      })
      .join('\n');

    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🚨 Needs a human', emoji: true },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*${args.operator.business_name}* · caller •••${last4} · convo \`${args.conversation.id.slice(0, 8)}\` · reason \`${args.reason}\``,
          },
        ],
      },
      args.reasonText
        ? {
            type: 'section',
            text: { type: 'mrkdwn', text: `*Why:* ${args.reasonText}` },
          }
        : null,
      transcriptText
        ? {
            type: 'section',
            text: { type: 'mrkdwn', text: transcriptText },
          }
        : null,
      {
        type: 'actions',
        block_id: 'esc_actions',
        elements: [
          {
            type: 'button',
            action_id: 'esc_back_to_bot',
            text: { type: 'plain_text', text: '↩ Resume AI', emoji: true },
            value: args.conversation.id,
          },
          {
            type: 'button',
            action_id: 'esc_mark_spam',
            text: { type: 'plain_text', text: '🚫 Mark spam', emoji: true },
            style: 'danger',
            value: args.conversation.id,
          },
          {
            type: 'button',
            action_id: 'esc_close',
            text: { type: 'plain_text', text: '✓ Close', emoji: true },
            value: args.conversation.id,
          },
          {
            type: 'button',
            action_id: 'esc_show_number',
            text: { type: 'plain_text', text: '👁 Show number', emoji: true },
            value: args.conversation.id,
          },
        ],
      },
    ].filter(Boolean);
  }

  // ── observability helper for /bb show-number ────────────────────────────

  async revealCallerNumber(args: {
    escalationId: string;
    requestedByUserId: string | null;
    requestedBySlackUserId: string;
  }): Promise<string> {
    const esc = await this.requireEscalation(args.escalationId);
    await this.audit.write({
      actorUserId: args.requestedByUserId,
      operatorId: esc.operator_id,
      action: 'escalation.show_number',
      resourceType: 'escalation',
      resourceId: esc.id,
      metadata: { slack_user_id: args.requestedBySlackUserId },
    });
    return esc.caller_phone_e164;
  }
}

// Surface AppError as the named type for callers/tests that expect it.
export { AppError };
