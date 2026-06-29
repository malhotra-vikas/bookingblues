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

const REASON_HUMAN: Record<EscalationReason, string> = {
  bot_stuck: 'Bot got stuck',
  caller_requested: 'Caller asked for a human',
  operator_forced: 'Operator forced from dashboard',
  calendar_revoked: 'Calendar access revoked',
  turn_cap: 'Conversation hit the turn cap',
};

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

  // ── conversation monitoring thread (every convo, in #convos) ────────────

  /**
   * Ensure a conversation has a Slack monitoring thread. Posts a low-key
   * parent message in SLACK_CONVOS_CHANNEL_ID and stores channel_id +
   * thread_ts on the conversation row. Idempotent — no-op if already opened
   * or if Slack isn't configured. Failures are logged and swallowed; the
   * caller's flow is never blocked by Slack.
   */
  async ensureConversationThread(args: {
    operator: OperatorRow;
    conversation: ConversationRow;
  }): Promise<{ channelId: string | null; threadTs: string | null }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cv = args.conversation as any;
    if (cv.slack_thread_ts && cv.slack_channel_id) {
      return {
        channelId: cv.slack_channel_id,
        threadTs: cv.slack_thread_ts,
      };
    }
    const convosChannel = this.slackApi.convosChannelId();
    if (!this.slackApi.isConfigured() || !convosChannel) {
      return { channelId: null, threadTs: null };
    }
    try {
      const last4 = args.conversation.caller_phone_e164.slice(-4);
      const post = await this.slackApi.postMessage({
        channel: convosChannel,
        text:
          `:eyes: *New conversation* — ${args.operator.business_name} · caller •••${last4} · convo \`${args.conversation.id.slice(0, 8)}\``,
        blocks: [
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `:eyes: *${args.operator.business_name}* · caller •••${last4} · convo \`${args.conversation.id.slice(0, 8)}\` · _new conversation_`,
              },
            ],
          },
        ],
      });
      if (post.ok && post.ts) {
        const channelId = post.channel ?? convosChannel;
        await this.supabase
          .db()
          .from('conversations')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ slack_channel_id: channelId, slack_thread_ts: post.ts } as any)
          .eq('id', args.conversation.id);
        return { channelId, threadTs: post.ts };
      }
      this.logger.warn(
        { conversationId: args.conversation.id, err: post.error },
        'openConversationThread postMessage returned ok=false',
      );
    } catch (err) {
      this.logger.warn(
        { conversationId: args.conversation.id, err: (err as Error).message },
        'openConversationThread failed (non-fatal)',
      );
    }
    return { channelId: null, threadTs: null };
  }

  /**
   * Post an operational alert into the conversation's #convos monitoring thread
   * (e.g. the AI advance failed and a human needs to follow up). Ensures the
   * thread exists first. Best-effort — Slack failures are logged, never thrown.
   */
  async postConversationThreadAlert(args: {
    operator: OperatorRow;
    conversation: ConversationRow;
    text: string;
  }): Promise<void> {
    const { channelId, threadTs } = await this.ensureConversationThread({
      operator: args.operator,
      conversation: args.conversation,
    });
    if (!channelId || !threadTs) return;
    try {
      await this.slackApi.postMessage({ channel: channelId, threadTs, text: args.text });
    } catch (err) {
      this.logger.warn(
        { conversationId: args.conversation.id, err: (err as Error).message },
        'postConversationThreadAlert failed (non-fatal)',
      );
    }
  }

  /**
   * Echo a caller's inbound SMS into the conversation's monitoring thread.
   * Always runs — pre- and post-escalation. Replaces the old
   * forwardCallerSmsToSlack which was gated on the conversation being in
   * `escalated` state.
   */
  async echoCallerMessageToConversationThread(args: {
    conversation: ConversationRow;
    body: string;
  }): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cv = args.conversation as any;
    if (!cv.slack_channel_id || !cv.slack_thread_ts) return;
    try {
      const last4 = args.conversation.caller_phone_e164.slice(-4);
      await this.slackApi.postMessage({
        channel: cv.slack_channel_id,
        threadTs: cv.slack_thread_ts,
        text: `📲 Caller (•••${last4}): ${args.body}`,
      });
    } catch (err) {
      this.logger.warn(
        { conversationId: args.conversation.id, err: (err as Error).message },
        'echoCallerMessageToConversationThread failed (non-fatal)',
      );
    }
  }

  // ── opening + state transitions ─────────────────────────────────────────

  /**
   * Open or reuse an escalation for a conversation. Posts a short alarm in
   * SLACK_DEFAULT_CHANNEL_ID (#hitl) — buttons + permalink to the
   * conversation's monitoring thread in #convos. The transcript itself
   * lives in the convo thread; we don't fork it here. If Slack isn't
   * configured / fails, falls back to email (Slice 10) and still flips the
   * conversation to `escalated` so the bot doesn't reply.
   */
  async openEscalation(args: {
    operator: OperatorRow;
    conversation: ConversationRow;
    callerPhoneE164: string;
    reason: EscalationReason;
    /** Free-form reason text from the AI (or the operator UI). */
    reasonText?: string;
    openedBy: 'bot' | 'caller' | 'operator';
    actorUserId?: string | null;
  }): Promise<{ escalation: EscalationRow; deliveredVia: 'slack' | 'email_fallback' | 'none' }> {
    const existing = await this.findOpenForConversation(args.conversation.id);
    if (existing) {
      return { escalation: existing, deliveredVia: existing.slack_thread_ts ? 'slack' : 'none' };
    }

    await this.flipConversationStatus(args.conversation.id, 'escalated');

    let deliveredVia: 'slack' | 'email_fallback' | 'none' = 'none';
    let channelId: string | null = null;
    let threadTs: string | null = null;

    const hitlChannel = this.slackApi.defaultChannelId();
    if (this.slackApi.isConfigured() && hitlChannel) {
      try {
        // Build a permalink to the convo thread (best-effort).
        let convoPermalink: string | null = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cv = args.conversation as any;
        if (cv.slack_channel_id && cv.slack_thread_ts) {
          try {
            const r = await this.slackApi.getPermalink({
              channel: cv.slack_channel_id,
              messageTs: cv.slack_thread_ts,
            });
            if (r.ok && r.permalink) convoPermalink = r.permalink;
          } catch {
            // Non-fatal; fall through to alarm without permalink.
          }
        }
        const post = await this.slackApi.postMessage({
          channel: hitlChannel,
          text: this.alarmText(args, convoPermalink),
          blocks: this.alarmBlocks(args, convoPermalink),
        });
        if (post.ok && post.ts) {
          channelId = post.channel ?? hitlChannel;
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
    // Reset the engagement turn baseline so the AI doesn't immediately re-hit
    // the §9.3 turn cap on the turns that led to the escalation.
    await this.supabase
      .db()
      .from('conversations')
      .update({ started_at: new Date().toISOString() })
      .eq('id', esc.conversation_id);

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
    // The thread can live in either channel:
    //   #hitl   — an open escalation row (alarm + buttons) — preferred since
    //             the agent's intent is clearly to intervene
    //   #convos — the conversation's monitoring thread, no open escalation
    //             required (agents can intervene any time)
    const esc = await this.findOpenByThread(args.channelId, args.threadTs);
    let operatorId: string;
    let conversationId: string;
    let callerPhoneE164: string;
    if (esc) {
      operatorId = esc.operator_id;
      conversationId = esc.conversation_id;
      callerPhoneE164 = esc.caller_phone_e164;
    } else {
      const convo = await this.findConversationByThread(args.channelId, args.threadTs);
      if (!convo) return { delivered: false, reason: 'no_matching_thread' };
      operatorId = convo.operator_id;
      conversationId = convo.id;
      callerPhoneE164 = convo.caller_phone_e164;
    }

    // §9.3 rate limit (8s/conversation outbound).
    const now = Date.now();
    const last = this.lastSmsAt.get(conversationId) ?? 0;
    if (now - last < SMS_BRIDGE_MIN_GAP_MS) {
      return { delivered: false, reason: 'rate_limited' };
    }

    const { data: op, error: opErr } = await this.supabase
      .db()
      .from('operators')
      .select('twilio_number_e164')
      .eq('id', operatorId)
      .maybeSingle();
    if (opErr) throw opErr;
    if (!op?.twilio_number_e164) {
      return { delivered: false, reason: 'no_operator_number' };
    }

    const send = await this.twilio.sendSms({
      from: op.twilio_number_e164,
      to: callerPhoneE164,
      body: args.text,
    });
    if ('skipped' in send) return { delivered: false, reason: `skipped:${send.skipped}` };
    this.lastSmsAt.set(conversationId, now);

    // Persist as a system-role message so the transcript shows the operator's reply.
    await this.conversations.appendMessage({
      conversationId,
      role: 'system',
      body: args.text,
      twilioMessageSid: send.sid,
    });
    // Stamp (channel, ts) so the status webhook can swap the delivery
    // reaction (⏳ → ✅/❌) on the agent's own Slack message.
    await this.supabase
      .db()
      .from('messages')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ slack_channel_id: args.channelId, slack_message_ts: args.slackMessageTs } as any)
      .eq('twilio_message_sid', send.sid);

    // ⏳ reaction at bridge time. The status webhook swaps this to ✅ on
    // delivered or ❌ on failed/undelivered. We can't chat.update the
    // agent's text (Slack only lets a bot edit its own posts), hence
    // reactions. Best-effort — Slack errors don't fail the SMS send.
    try {
      if (this.slackApi.isConfigured()) {
        await this.slackApi.addReaction({
          channel: args.channelId,
          timestamp: args.slackMessageTs,
          name: 'hourglass_flowing_sand',
        });
      }
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, sid: send.sid },
        'addReaction(hourglass) failed (non-fatal)',
      );
    }

    return { delivered: true };
  }

  /** Look up a conversation by the Slack thread its monitoring post lives in. */
  private async findConversationByThread(
    channelId: string,
    threadTs: string,
  ): Promise<{ id: string; operator_id: string; caller_phone_e164: string } | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = this.supabase.db() as any;
    const { data, error } = await client
      .from('conversations')
      .select('id, operator_id, caller_phone_e164')
      .eq('slack_channel_id', channelId)
      .eq('slack_thread_ts', threadTs)
      .maybeSingle();
    if (error) throw error;
    return data ?? null;
  }

  /**
   * Mirror the AI bot's outbound SMS into the conversation's monitoring
   * thread in #convos (and the escalation thread in #hitl when one is open).
   * Lets the team watch both sides of the conversation live and decide
   * whether to intervene. Best-effort — any Slack failure is swallowed so
   * the bot's SMS pipeline is never blocked by Slack downtime.
   */
  async echoBotReplyToOpenEscalation(args: {
    conversationId: string;
    text: string;
    twilioMessageSid?: string;
  }): Promise<void> {
    try {
      const body = args.text.length > 480 ? `${args.text.slice(0, 480)}…` : args.text;
      // ⏳ at post time — the Twilio status callback will chat.update this to
      // ✅ on delivery or ❌ on failure. See TwilioStatusController.
      const text = `⏳ 🤖 Bot: ${body}`;

      // 1) The conversation's monitoring thread (#convos) — every convo has one
      //    if the bot is configured; runs pre-escalation too. This is the
      //    Slack message we mark with the delivery indicator (canonical echo).
      const { data: convo } = await this.supabase
        .db()
        .from('conversations')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select('slack_channel_id, slack_thread_ts' as any)
        .eq('id', args.conversationId)
        .maybeSingle();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = convo as any;
      if (c?.slack_channel_id && c?.slack_thread_ts) {
        const post = await this.slackApi.postMessage({
          channel: c.slack_channel_id,
          threadTs: c.slack_thread_ts,
          text,
        });
        // Stamp the (channel, ts) back-reference onto the message row so the
        // status webhook can find this Slack message and swap the marker.
        // Only stamp the canonical #convos echo — the #hitl mirror below is
        // intentionally left un-marked (one source of truth per message).
        if (post.ok && post.ts && args.twilioMessageSid) {
          await this.supabase
            .db()
            .from('messages')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ slack_channel_id: c.slack_channel_id, slack_message_ts: post.ts } as any)
            .eq('twilio_message_sid', args.twilioMessageSid);
        }
      }

      // 2) The escalation thread (#hitl) — only when an escalation is open and
      //    has its own thread. Skip if it's the same channel/ts as the convo
      //    thread (defensive — shouldn't happen with split channels). Not
      //    marker-tracked; agents read both threads anyway.
      const esc = await this.findOpenForConversation(args.conversationId);
      if (
        esc?.slack_channel_id &&
        esc.slack_thread_ts &&
        !(esc.slack_channel_id === c?.slack_channel_id && esc.slack_thread_ts === c?.slack_thread_ts)
      ) {
        await this.slackApi.postMessage({
          channel: esc.slack_channel_id,
          threadTs: esc.slack_thread_ts,
          text,
        });
      }
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

  // ── Slack message formatting (escalation alarm in #hitl) ───────────────

  private alarmText(
    args: { operator: OperatorRow; conversation: ConversationRow; callerPhoneE164: string; reason: EscalationReason; reasonText?: string; openedBy: 'bot' | 'caller' | 'operator' },
    permalink: string | null,
  ): string {
    const last4 = args.callerPhoneE164.slice(-4);
    const reasonHuman = REASON_HUMAN[args.reason];
    const lines = [
      `:rotating_light: *Needs a human* — ${reasonHuman} (opened by ${args.openedBy})`,
      `${args.operator.business_name} · caller •••${last4} · convo \`${args.conversation.id.slice(0, 8)}\``,
    ];
    if (args.reasonText) lines.push('', `*Why:* ${args.reasonText}`);
    if (permalink) lines.push('', `Transcript & live updates: ${permalink}`);
    lines.push(
      '',
      "_Reply in the conversation thread to send an SMS to the caller. Use the buttons below to resume the AI, mark spam, close, or reveal the caller's full number (audit-logged)._",
    );
    return lines.join('\n');
  }

  private alarmBlocks(
    args: { operator: OperatorRow; conversation: ConversationRow; callerPhoneE164: string; reason: EscalationReason; reasonText?: string },
    permalink: string | null,
  ): ReadonlyArray<unknown> {
    const last4 = args.callerPhoneE164.slice(-4);
    const reasonHuman = REASON_HUMAN[args.reason];
    return [
      { type: 'header', text: { type: 'plain_text', text: '🚨 Needs a human', emoji: true } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*${args.operator.business_name}* · caller •••${last4} · convo \`${args.conversation.id.slice(0, 8)}\` · ${reasonHuman}`,
          },
        ],
      },
      args.reasonText ? { type: 'section', text: { type: 'mrkdwn', text: `*Why:* ${args.reasonText}` } } : null,
      permalink
        ? {
            type: 'section',
            text: { type: 'mrkdwn', text: `<${permalink}|→ Open the conversation thread>` },
          }
        : null,
      {
        type: 'actions',
        block_id: 'esc_actions',
        elements: [
          { type: 'button', action_id: 'esc_back_to_bot', text: { type: 'plain_text', text: '↩ Resume AI', emoji: true }, value: args.conversation.id },
          { type: 'button', action_id: 'esc_mark_spam', text: { type: 'plain_text', text: '🚫 Mark spam', emoji: true }, style: 'danger', value: args.conversation.id },
          { type: 'button', action_id: 'esc_close', text: { type: 'plain_text', text: '✓ Close', emoji: true }, value: args.conversation.id },
          { type: 'button', action_id: 'esc_show_number', text: { type: 'plain_text', text: '👁 Show number', emoji: true }, value: args.conversation.id },
          { type: 'button', action_id: 'esc_book', text: { type: 'plain_text', text: '📅 Book a slot', emoji: true }, style: 'primary', value: args.conversation.id },
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
