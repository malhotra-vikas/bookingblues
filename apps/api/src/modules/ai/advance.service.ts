import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type OpenAI from 'openai';
import type { Tables } from '@bookingblues/db-types';

import { ValidationError } from '../../common/errors/app-error';
import { BOOKING_MODEL, OpenAIService } from '../../common/openai/openai.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { CalendarService } from '../calendar/calendar.service';
import { ConversationsService } from '../conversations/conversations.service';
import { PaymentsService } from '../payments/payments.service';
import { EscalationsService } from '../slack/escalations.service';
import { assembleSystemPrompt, wrapCallerMessage } from './prompts';
import {
  bookAppointment,
  checkAvailability,
  escalateToHuman,
  markOutOfScope,
  markSpam,
  proposeSlots,
  requestPaymentLink,
} from './tool-handlers';
import type { ToolContext, ToolResult } from './tool-handlers';
import {
  BookAppointmentArgs,
  CheckAvailabilityArgs,
  EscalateToHumanArgs,
  MarkOutOfScopeArgs,
  MarkSpamArgs,
  ProposeSlotsArgs,
  RequestPaymentLinkArgs,
  TOOL_DEFINITIONS,
} from './tool-definitions';

type ConversationRow = Tables<'conversations'>;
type OperatorRow = Tables<'operators'>;

const MAX_CALLER_TURNS = 20;
const MAX_TOOL_ITERATIONS = 5;

@Injectable()
export class AdvanceService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly openai: OpenAIService,
    private readonly calendar: CalendarService,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly payments: PaymentsService,
    private readonly escalations: EscalationsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdvanceService.name);
  }

  async advance(args: {
    operator: OperatorRow;
    conversation: ConversationRow;
    callerPhoneE164: string;
  }): Promise<void> {
    const { operator, conversation, callerPhoneE164 } = args;

    if (!operator.twilio_number_e164) {
      this.logger.warn(
        { operatorId: operator.id, conversationId: conversation.id },
        'advance called for operator with no Twilio number; skipping',
      );
      return;
    }

    // §12 + Slice 7.5: when a conversation is in `escalated`, the AI must not
    // reply. Caller messages are routed to the Slack thread by the SMS webhook,
    // not by this loop. The bridge here is just a safety net in case the
    // webhook gates ever drift.
    if (conversation.status === 'escalated') {
      this.logger.info(
        { conversationId: conversation.id, operatorId: operator.id },
        'advance skipped: conversation is escalated',
      );
      return;
    }

    // Caller-turn cap (CLAUDE.md §9.3) — count caller messages on this convo.
    const { count: callerTurns } = await this.supabase
      .db()
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('role', 'caller');
    if ((callerTurns ?? 0) >= MAX_CALLER_TURNS) {
      const result = await escalateToHuman(
        { reason: `turn_cap: caller turn cap (${MAX_CALLER_TURNS}) reached` },
        this.toolCtx(operator, conversation, callerPhoneE164),
      );
      await this.applyTerminal(conversation.id, result);
      if (result.outboundMessage) {
        await this.sendBotSms(operator.twilio_number_e164, callerPhoneE164, conversation.id, result.outboundMessage);
      }
      return;
    }

    const ctx = this.toolCtx(operator, conversation, callerPhoneE164);

    // Load category (best-effort) for the system prompt template.
    const { data: category } = operator.category
      ? await this.supabase
          .db()
          .from('categories')
          .select('*')
          .eq('slug', operator.category)
          .maybeSingle()
      : { data: null };

    const messages = await this.buildMessages(operator, category, conversation.id);

    let assistantText: string | null = null;
    let terminal: ToolResult | null = null;

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
      const completion = await this.openai.client_().chat.completions.create({
        model: BOOKING_MODEL,
        messages,
        tools: [...TOOL_DEFINITIONS] as OpenAI.Chat.Completions.ChatCompletionTool[],
        tool_choice: 'auto',
      });
      const choice = completion.choices[0];
      if (!choice) break;
      const msg = choice.message;
      messages.push(msg);

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        assistantText = msg.content ?? null;
        break;
      }

      let terminatedThisIter = false;
      for (const call of toolCalls) {
        if (call.type !== 'function') continue;
        const result = await this.dispatchTool(call.function.name, call.function.arguments, ctx);

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result.content),
        });

        if (result.state) {
          terminal = result;
          terminatedThisIter = true;
        }
      }

      if (terminatedThisIter) break;
    }

    // Apply terminal state first so it's reflected even if SMS send fails.
    if (terminal) {
      await this.applyTerminal(conversation.id, terminal);
      if (terminal.outboundMessage && !terminal.silentTerminate) {
        await this.sendBotSms(
          operator.twilio_number_e164,
          callerPhoneE164,
          conversation.id,
          terminal.outboundMessage,
        );
      }
      return;
    }

    if (assistantText && assistantText.trim().length > 0) {
      await this.sendBotSms(
        operator.twilio_number_e164,
        callerPhoneE164,
        conversation.id,
        assistantText,
      );
      // Move conversation back to awaiting_caller after a non-terminal reply.
      await this.supabase
        .db()
        .from('conversations')
        .update({ status: 'awaiting_caller' })
        .eq('id', conversation.id);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private toolCtx(
    operator: OperatorRow,
    conversation: ConversationRow,
    callerPhoneE164: string,
  ): ToolContext {
    return {
      operator,
      conversation,
      callerPhoneE164,
      supabase: this.supabase,
      calendar: this.calendar,
      twilio: this.twilio,
      conversations: this.conversations,
      payments: this.payments,
      escalations: this.escalations,
      logger: this.logger,
    };
  }

  private async buildMessages(
    operator: OperatorRow,
    category: Tables<'categories'> | null,
    conversationId: string,
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    const system = assembleSystemPrompt({
      operator,
      category,
      nowIso: new Date().toISOString(),
    });
    const { data: history, error } = await this.supabase
      .db()
      .from('messages')
      .select('role, body, created_at')
      .eq('conversation_id', conversationId)
      .in('role', ['caller', 'bot'])
      .order('created_at', { ascending: true });
    if (error) throw error;

    const turns: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = (history ?? []).map(
      (m) => {
        if (m.role === 'caller') {
          return { role: 'user' as const, content: wrapCallerMessage(m.body) };
        }
        return { role: 'assistant' as const, content: m.body };
      },
    );
    return [{ role: 'system', content: system }, ...turns];
  }

  private async dispatchTool(
    name: string,
    rawArgs: string,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      throw new ValidationError(`Tool ${name} returned non-JSON arguments`);
    }
    switch (name) {
      case 'check_availability':
        return checkAvailability(CheckAvailabilityArgs.parse(parsed), ctx);
      case 'propose_slots':
        return proposeSlots(ProposeSlotsArgs.parse(parsed));
      case 'book_appointment':
        return bookAppointment(BookAppointmentArgs.parse(parsed), ctx);
      case 'request_payment_link':
        return requestPaymentLink(RequestPaymentLinkArgs.parse(parsed), ctx);
      case 'mark_out_of_scope':
        return markOutOfScope(MarkOutOfScopeArgs.parse(parsed), ctx);
      case 'mark_spam':
        return markSpam(MarkSpamArgs.parse(parsed));
      case 'escalate_to_human':
        return await escalateToHuman(EscalateToHumanArgs.parse(parsed), ctx);
      default:
        throw new ValidationError(`Unknown tool: ${name}`);
    }
  }

  private async applyTerminal(conversationId: string, result: ToolResult): Promise<void> {
    if (!result.state) return;
    const status = result.state === 'escalated' ? 'escalated' : 'completed';
    const update: { status: typeof status; completed_at?: string; outcome?: Outcome } = {
      status,
    };
    if (status === 'completed') update.completed_at = new Date().toISOString();
    if (result.outcome) update.outcome = result.outcome;

    const { error } = await this.supabase
      .db()
      .from('conversations')
      .update(update)
      .eq('id', conversationId);
    if (error) throw error;
  }

  private async sendBotSms(
    fromE164: string,
    toE164: string,
    conversationId: string,
    body: string,
  ): Promise<void> {
    const send = await this.twilio.sendSms({ from: fromE164, to: toE164, body });
    await this.conversations.appendMessage({
      conversationId,
      role: 'bot',
      body: 'sid' in send ? body : `[skipped: ${send.skipped}] ${body}`,
      ...('sid' in send ? { twilioMessageSid: send.sid } : {}),
    });
    // Mirror into the Slack thread if a human resumed an open escalation.
    // No-op when there's no open escalation or no Slack thread.
    if ('sid' in send) {
      await this.escalations.echoBotReplyToOpenEscalation({ conversationId, text: body });
    }
  }
}

type Outcome = NonNullable<ToolResult['outcome']>;
