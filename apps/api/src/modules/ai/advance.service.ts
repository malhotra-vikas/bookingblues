import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type OpenAI from 'openai';
import { ZodError } from 'zod';
import type { Tables } from '@bookingblues/db-types';

import { BOOKING_MODEL, OpenAIService } from '../../common/openai/openai.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { CalendarService } from '../calendar/calendar.service';
import { ConversationsService } from '../conversations/conversations.service';
import {
  AI_UNAVAILABLE_MARKER,
  DEGRADED_HANDOFF_MARKER,
  aiUnavailableFallbackSms,
  degradedHandoffSms,
} from '../conversations/templates/sms-templates';
import { BookingsService } from '../appointments/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { EscalationsService } from '../slack/escalations.service';
import { assembleSystemPrompt, wrapCallerMessage } from './prompts';
import {
  bookAppointment,
  checkAvailability,
  checkServiceArea,
  collectServiceAddress,
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
  CheckServiceAreaArgs,
  EscalateToHumanArgs,
  MarkOutOfScopeArgs,
  CollectServiceAddressArgs,
  MarkSpamArgs,
  ProposeSlotsArgs,
  RequestPaymentLinkArgs,
  TOOL_DEFINITIONS,
} from './tool-definitions';

type ConversationRow = Tables<'conversations'>;
type OperatorRow = Tables<'operators'>;

const MAX_CALLER_TURNS = 20;
const MAX_TOOL_ITERATIONS = 5;

/**
 * Subscription states in which the AI booking loop runs normally. Anything else
 * (past_due / canceled / incomplete / incomplete_expired / none) drops into the
 * §9.5 Flow A degraded mode: the caller still gets the voice greeting + opening
 * SMS, but no AI booking and no fee collection.
 */
const GOOD_STANDING_STATUSES: ReadonlySet<string> = new Set(['trialing', 'active']);

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
    private readonly bookings: BookingsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdvanceService.name);
  }

  async advance(args: {
    operator: OperatorRow;
    conversation: ConversationRow;
    callerPhoneE164: string;
  }): Promise<void> {
    const { operator, callerPhoneE164 } = args;
    let conversation = args.conversation;

    if (!operator.twilio_number_e164) {
      this.logger.warn(
        { operatorId: operator.id, conversationId: conversation.id },
        'advance called for operator with no Twilio number; skipping',
      );
      return;
    }

    // §12 + Slice 7.5 — human-owns-it gating. We DON'T trust
    // `conversation.status === 'escalated'` alone: old rows can drift into
    // 'escalated' with no open escalation (resolve/spam paths that didn't
    // flip status, or pre-fix data). The escalation row is the truth.
    //
    // The Twilio SMS webhook already gates on this same predicate before
    // calling advance — this is a defense-in-depth check in case a future
    // caller (manual replay, future queue) bypasses the controller.
    const openEsc = await this.escalations.findOpenForConversation(conversation.id);
    if (openEsc) {
      this.logger.info(
        { conversationId: conversation.id, operatorId: operator.id, escalationId: openEsc.id },
        'advance skipped: open escalation owns this conversation',
      );
      return;
    }
    if (conversation.status === 'escalated') {
      // Drifted state — heal it so the rest of the loop (and the dashboard)
      // see the correct status. Next caller turn will resume normally.
      this.logger.warn(
        { conversationId: conversation.id },
        'healing drifted escalated status (no open escalation row)',
      );
      await this.supabase
        .db()
        .from('conversations')
        .update({ status: 'awaiting_caller' })
        .eq('id', conversation.id);
      conversation = { ...conversation, status: 'awaiting_caller' };
    }

    // Cross-replica mutex. The in-process debounce in AdvanceSchedulerService
    // collapses bursts within a single API replica, but Railway autoscale
    // and rolling deploys mean two Twilio webhooks for the same conversation
    // can hit different replicas — each schedules its own timer, both fire,
    // two OpenAI calls, two SMS replies. This atomic claim ensures only one
    // wins. The TTL (30s) covers a normal advance (~5s); a crashed holder
    // auto-unlocks after expiry. The second replica reads all caller turns
    // from history anyway, so dropping its advance loses nothing.
    const ADVANCE_LOCK_TTL_MS = 30_000;
    const lockUntilIso = new Date(Date.now() + ADVANCE_LOCK_TTL_MS).toISOString();
    const nowIso = new Date().toISOString();
    const { data: claimed } = await this.supabase
      .db()
      .from('conversations')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ advance_locked_until: lockUntilIso } as any)
      .eq('id', conversation.id)
      .or(`advance_locked_until.is.null,advance_locked_until.lt.${nowIso}`)
      .select('id')
      .maybeSingle();
    if (!claimed) {
      this.logger.info(
        { conversationId: conversation.id },
        'advance skipped: lock held by another worker',
      );
      return;
    }

    try {
    // Already-answered guard. The lock prevents PARALLEL advances; this guard
    // closes the SEQUENTIAL race that produces duplicate bot replies:
    //   t0: caller msg1 → debounce timer T1
    //   t1: T1 fires → advance A reads [msg1], replies, releases lock
    //   t2: caller msg2 arrives (after A's release) → timer T2
    //   t3: T2 fires → advance B reads [msg1, msg2, bot_reply_1] — OpenAI sees
    //       the convo ends with an assistant turn and generates a continuation,
    //       producing a phantom second reply. (QA 2026-05-13)
    // If the newest message isn't from the caller, there's nothing new for the
    // bot to respond to — skip. New caller turns after this point will trigger
    // a fresh advance via the SMS webhook → scheduler path.
    const { data: latest, error: latestErr } = await this.supabase
      .db()
      .from('messages')
      .select('role')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) throw latestErr;
    if (latest && latest.role !== 'caller') {
      this.logger.info(
        { conversationId: conversation.id, latestRole: latest.role },
        'advance skipped: latest message is not a caller turn',
      );
      return;
    }

    // Degraded mode (CLAUDE.md §9.5 Flow A). When the operator's subscription is
    // not in good standing (past_due / canceled / incomplete / none), we do NOT
    // run the AI booking loop and do NOT collect fees. The caller already got the
    // voice greeting + opening SMS; send one polite handoff and stop. Repeat
    // caller turns aren't re-notified (dedupe on the marker).
    if (
      !operator.subscription_status ||
      !GOOD_STANDING_STATUSES.has(operator.subscription_status)
    ) {
      if (!(await this.degradedNoticeAlreadySent(conversation.id))) {
        await this.sendBotSms(
          operator.twilio_number_e164,
          callerPhoneE164,
          conversation.id,
          degradedHandoffSms(operator.business_name),
        );
      }
      this.logger.warn(
        {
          operatorId: operator.id,
          conversationId: conversation.id,
          subscriptionStatus: operator.subscription_status,
        },
        'advance degraded: operator not in good standing — skipped AI booking loop',
      );
      return;
    }

    // Caller-turn cap (CLAUDE.md §9.3) — count caller messages in the CURRENT
    // engagement only (since `started_at`), not the conversation's lifetime. A
    // conversation row is reused across follow-ups (resume window) and after a
    // human hands back (back-to-bot); `started_at` is reset at those points, so
    // a brand-new engagement starts at 0 instead of inheriting old turns and
    // force-escalating immediately (QA 2026-06-29).
    const { count: callerTurns } = await this.supabase
      .db()
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('role', 'caller')
      .gte('created_at', conversation.started_at);
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
    // A non-terminal tool that wants to stop the loop and send one SMS without
    // completing the conversation (e.g. reserve→pay: hold the slot, text the
    // payment link, stay open awaiting payment).
    let stopLoopResult: ToolResult | null = null;
    // Out-of-band SMS from non-terminal tools that DON'T stop the loop — these
    // were previously dropped (only terminal.outboundMessage was ever sent).
    const pendingOutbound: string[] = [];

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

      let stopThisIter = false;
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
          stopThisIter = true;
        } else if (result.stopLoop) {
          stopLoopResult = result;
          stopThisIter = true;
        } else if (result.outboundMessage) {
          pendingOutbound.push(result.outboundMessage);
        }
      }

      if (stopThisIter) break;
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

    // Non-terminal stop (reserve→pay): send the single payment-link SMS and
    // keep the conversation open (awaiting the caller's payment).
    if (stopLoopResult) {
      if (stopLoopResult.outboundMessage) {
        await this.sendBotSms(
          operator.twilio_number_e164,
          callerPhoneE164,
          conversation.id,
          stopLoopResult.outboundMessage,
        );
      }
      await this.supabase
        .db()
        .from('conversations')
        .update({ status: 'awaiting_caller' })
        .eq('id', conversation.id);
      return;
    }

    if (assistantText && assistantText.trim().length > 0) {
      await this.sendBotSms(
        operator.twilio_number_e164,
        callerPhoneE164,
        conversation.id,
        assistantText,
      );
    }
    // Flush any out-of-band SMS from non-terminal tools (e.g. a legacy
    // request_payment_link call) so the link is never dropped.
    for (const body of pendingOutbound) {
      await this.sendBotSms(operator.twilio_number_e164, callerPhoneE164, conversation.id, body);
    }
    if ((assistantText && assistantText.trim().length > 0) || pendingOutbound.length > 0) {
      // Move conversation back to awaiting_caller after a non-terminal reply.
      await this.supabase
        .db()
        .from('conversations')
        .update({ status: 'awaiting_caller' })
        .eq('id', conversation.id);
    }
    } catch (err) {
      // The AI advance failed (e.g. OpenAI outage / quota / timeout). Never leave
      // the caller in silence: send one fallback SMS and alert the team in the
      // #convos thread to follow up manually. Then swallow — we've handled it.
      await this.handleAdvanceFailure(operator, conversation, callerPhoneE164, err);
    } finally {
      // Release the cross-replica lock. Best-effort — if this fails the
      // TTL (30s) will release it eventually.
      await this.supabase
        .db()
        .from('conversations')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ advance_locked_until: null } as any)
        .eq('id', conversation.id);
    }
  }

  /**
   * Graceful degradation when the AI advance throws: send the caller a single
   * fallback SMS (deduped on a stable marker so an outage doesn't spam them) and
   * post an alert into the conversation's #convos thread so a human follows up.
   * Each sub-step is independently guarded — a Slack failure must not block the
   * SMS, and vice-versa.
   */
  private async handleAdvanceFailure(
    operator: OperatorRow,
    conversation: ConversationRow,
    callerPhoneE164: string,
    err: unknown,
  ): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    this.logger.error(
      { operatorId: operator.id, conversationId: conversation.id, err: reason },
      'advance failed — sending caller fallback SMS + #convos alert',
    );

    const alreadyHandled = await this.aiFallbackAlreadySent(conversation.id);

    if (!alreadyHandled) {
      const fromNumber = operator.twilio_number_e164;
      if (fromNumber) {
        try {
          await this.sendBotSms(
            fromNumber,
            callerPhoneE164,
            conversation.id,
            aiUnavailableFallbackSms(operator.business_name),
          );
        } catch (smsErr) {
          this.logger.error(
            { conversationId: conversation.id, err: (smsErr as Error).message },
            'advance-failure fallback SMS send failed',
          );
        }
      }

      try {
        await this.escalations.postConversationThreadAlert({
          operator,
          conversation,
          text:
            `:rotating_light: *AI failed to respond — please follow up with this caller.* ` +
            `A fallback text was sent. Error: \`${reason.slice(0, 160)}\``,
        });
      } catch (slackErr) {
        this.logger.error(
          { conversationId: conversation.id, err: (slackErr as Error).message },
          'advance-failure Slack alert failed',
        );
      }
    }
  }

  /**
   * Has the AI-unavailable fallback already been sent on this conversation?
   * Dedupes both the caller SMS and the #convos alert so repeated caller turns
   * during an outage produce one fallback + one alert, not a storm.
   */
  private async aiFallbackAlreadySent(conversationId: string): Promise<boolean> {
    const { data } = await this.supabase
      .db()
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('role', 'bot')
      .ilike('body', `%${AI_UNAVAILABLE_MARKER}%`)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
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
      bookings: this.bookings,
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
      return {
        content: {
          error: 'invalid_arguments',
          message: `Tool ${name} arguments were not valid JSON. Re-emit the call with proper JSON.`,
        },
      };
    }
    // Each branch parses into its zod schema. Validation failures used to
    // throw and crash the whole advance loop (caller got no reply, see
    // logs 2026-05-13 book_appointment caller_name min(1)). Now we feed the
    // error back to the model as a tool response so it can correct itself
    // (e.g. re-ask the caller for their name) within the same advance turn.
    try {
      switch (name) {
        case 'check_service_area':
          return checkServiceArea(CheckServiceAreaArgs.parse(parsed), ctx);
        case 'check_availability':
          return await checkAvailability(CheckAvailabilityArgs.parse(parsed), ctx);
        case 'propose_slots':
          return proposeSlots(ProposeSlotsArgs.parse(parsed));
        case 'book_appointment':
          return await bookAppointment(BookAppointmentArgs.parse(parsed), ctx);
        case 'request_payment_link':
          return await requestPaymentLink(RequestPaymentLinkArgs.parse(parsed), ctx);
        case 'collect_service_address':
          return await collectServiceAddress(CollectServiceAddressArgs.parse(parsed), ctx);
        case 'mark_out_of_scope':
          return markOutOfScope(MarkOutOfScopeArgs.parse(parsed), ctx);
        case 'mark_spam':
          return markSpam(MarkSpamArgs.parse(parsed));
        case 'escalate_to_human':
          return await escalateToHuman(EscalateToHumanArgs.parse(parsed), ctx);
        default:
          return {
            content: { error: 'unknown_tool', message: `Unknown tool: ${name}` },
          };
      }
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }));
        this.logger.warn(
          { tool: name, issues },
          'tool args failed zod validation; feeding error back to model',
        );
        return {
          content: {
            error: 'invalid_arguments',
            tool: name,
            issues,
            message:
              'Tool arguments failed validation. Inspect issues[] and either correct the call or ask the caller for the missing information.',
          },
        };
      }
      throw err;
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

  /**
   * Has a degraded-mode handoff SMS already been sent on this conversation?
   * Matches the stable marker substring on any prior bot message so repeat
   * caller turns during past-due/degraded mode aren't notified every time.
   */
  private async degradedNoticeAlreadySent(conversationId: string): Promise<boolean> {
    const { data } = await this.supabase
      .db()
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('role', 'bot')
      .ilike('body', `%${DEGRADED_HANDOFF_MARKER}%`)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
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
      await this.escalations.echoBotReplyToOpenEscalation({
        conversationId,
        text: body,
        twilioMessageSid: send.sid,
      });
    }
  }
}

type Outcome = NonNullable<ToolResult['outcome']>;
