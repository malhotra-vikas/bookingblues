import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Json } from '@bookingblues/db-types';
import { PinoLogger } from 'nestjs-pino';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { emergencyAlertSms } from '../conversations/templates/sms-templates';
import { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AdvanceSchedulerService } from '../ai/advance-scheduler.service';
import { isOfficeAppointmentCategory } from '../ai/category-profile';
import { AdvanceService } from '../ai/advance.service';
import { ConversationsService } from '../conversations/conversations.service';
import { detectEmergencyKeyword } from '../conversations/emergency-detection';
import { EmergencyClassifierService } from '../conversations/emergency-classifier.service';
import { EscalationsService } from '../slack/escalations.service';
import { ConversationOpeningService, isCarrierKeyword } from './conversation-opening.service';
import { resolveOperatorForWebhook, verifyTwilioSignature } from './twilio-helpers';

interface TwilioSmsForm {
  readonly MessageSid?: string;
  readonly From?: string;
  readonly To?: string;
  readonly Body?: string;
  readonly [k: string]: string | undefined;
}

@Controller('webhooks/twilio/sms')
@SkipThrottle()
export class TwilioSmsController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly emergencyClassifier: EmergencyClassifierService,
    private readonly advance: AdvanceService,
    private readonly advanceScheduler: AdvanceSchedulerService,
    private readonly escalations: EscalationsService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly opening: ConversationOpeningService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(TwilioSmsController.name);
  }

  @Post(':operatorId')
  @HttpCode(200)
  @Header('content-type', 'text/xml')
  async handle(
    @Req() req: Request,
    @Param('operatorId') operatorId: string,
    @Body() form: TwilioSmsForm,
  ): Promise<string> {
    verifyTwilioSignature({
      twilio: this.twilio,
      apiUrl: this.env.API_URL,
      req,
      formBody: form as Record<string, string>,
    });

    const operator = await resolveOperatorForWebhook({
      supabase: this.supabase,
      operatorId,
      to: form.To,
    });

    if (!form.MessageSid || !form.From || !form.Body) {
      return this.emptyResponse();
    }

    const recorded = await this.idempotency.record({
      source: 'twilio',
      eventId: form.MessageSid,
      payload: form as unknown as Json,
      signatureVerified: true,
    });
    if (recorded.status !== 'new') return this.emptyResponse();

    let convoId: string | null = null;
    try {
      const convo = await this.conversations.getOrCreate(operator.id, form.From);
      convoId = convo.id;
      await this.conversations.appendMessage({
        conversationId: convo.id,
        role: 'caller',
        body: form.Body,
        twilioMessageSid: form.MessageSid,
      });
      await this.idempotency.markProcessed(recorded.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.idempotency.markFailed(recorded.id, msg);
      this.logger.error({ err: msg, operatorId: operator.id }, 'sms persist failed');
      throw err;
    }

    // Best-effort advance OR Slack bridge. Failures here (missing OPENAI_API_KEY
    // in dev, OpenAI 5xx, calendar issues, Slack rate limits) are logged but do
    // not fail the Twilio webhook — Twilio would retry-loop and we'd duplicate
    // the inbound. A future pg-boss queue (CLAUDE.md §6) will own retry semantics.
    try {
      const operatorRow = (
        await this.supabase
          .db()
          .from('operators')
          .select('*')
          .eq('id', operator.id)
          .single()
      ).data;
      if (operatorRow && convoId) {
        const convoFull = (
          await this.supabase
            .db()
            .from('conversations')
            .select('*')
            .eq('id', convoId)
            .single()
        ).data;
        if (convoFull) {
          // Slice 7.5 (ADR 0010 amendment): every conversation has a
          // monitoring thread in #convos. Open it on first contact (idempotent).
          const thread = await this.escalations.ensureConversationThread({
            operator: operatorRow,
            conversation: convoFull,
          });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cvFull = convoFull as any;
          if (thread.threadTs && !cvFull.slack_thread_ts) {
            // ensureConversationThread persisted the columns; reflect locally
            // so the echo path below sees them.
            cvFull.slack_channel_id = thread.channelId;
            cvFull.slack_thread_ts = thread.threadTs;
          }

          // Always echo the caller's inbound SMS into the convo thread —
          // pre- and post-escalation. Source-of-truth transcript surface.
          await this.escalations.echoCallerMessageToConversationThread({
            conversation: convoFull,
            body: form.Body,
          });

          // Emergency detection — hybrid (PROGRESS.md Slice 17 item 17).
          //   1) Keyword pre-filter: zero-cost / zero-latency. Catches the
          //      obvious cases ("burst pipe", "gas smell").
          //   2) AI fallback (gpt-4.1-mini): catches non-obvious phrasings
          //      that keyword lists miss ("water everywhere in the
          //      basement"). ~1s, ~$0.0005 per call. Skipped when the
          //      keyword path already triggered (no point paying twice).
          // Both paths fire-and-forget — the AI advance loop continues in
          // parallel, so neither path delays the caller's reply. V1 has no
          // in-conversation dedup; rare in practice. Office-appointment
          // categories (Insurance Agencies) have no emergency concept.
          if (
            operatorRow.personal_phone_e164 &&
            operatorRow.twilio_number_e164 &&
            !isOfficeAppointmentCategory(operatorRow.category)
          ) {
            const operatorPhone = operatorRow.personal_phone_e164;
            const twilioFrom = operatorRow.twilio_number_e164;
            const callerLast4 = form.From.slice(-4);
            const callerFrom = form.From;
            const businessName = operatorRow.business_name;
            const operatorId = operatorRow.id;
            const conversationId = convoFull.id;

            const sendAlert = (reason: string, source: 'keyword' | 'ai'): void => {
              // Non-blocking HITL heads-up in #hitl — independent of whether the
              // model later calls escalate_to_human. Guarantees a human sees the
              // emergency even if the AI handles (or fumbles) it. Fire-and-forget.
              this.escalations
                .postEmergencyAlert({
                  operator: operatorRow,
                  conversation: convoFull,
                  callerPhoneE164: callerFrom,
                  reason,
                })
                .catch((err) => {
                  this.logger.warn(
                    { err: err instanceof Error ? err.message : String(err), operatorId, conversationId, source },
                    'emergency HITL alert failed (non-fatal)',
                  );
                });

              const alert = emergencyAlertSms({ businessName, callerLast4, reason, callerFrom });
              this.twilio
                .sendSms({ from: twilioFrom, to: operatorPhone, body: alert })
                .then((res) => {
                  if ('skipped' in res) {
                    this.logger.warn(
                      { operatorId, conversationId, source, reason, allowlist_skip: res.skipped },
                      'emergency alert SMS skipped (allowlist)',
                    );
                  } else {
                    this.logger.info(
                      { operatorId, conversationId, source, reason, alertSid: res.sid },
                      'emergency alert SMS sent to operator',
                    );
                  }
                })
                .catch((err) => {
                  this.logger.error(
                    {
                      err: err instanceof Error ? err.message : String(err),
                      operatorId,
                      conversationId,
                      source,
                      reason,
                    },
                    'emergency alert SMS failed (non-fatal — AI advance continues)',
                  );
                });
            };

            const keywordHit = detectEmergencyKeyword(form.Body);
            if (keywordHit) {
              sendAlert(`"${keywordHit}"`, 'keyword');
            } else {
              // Fire-and-forget AI classification — don't await. Pass the
              // operator's trade so the emergency definition is trade-aware.
              this.emergencyClassifier
                .classify(form.Body, operatorRow.category)
                .then((cls) => {
                  if (cls?.is_emergency && cls.reason) {
                    sendAlert(cls.reason, 'ai');
                  }
                })
                .catch((err) => {
                  this.logger.warn(
                    {
                      err: err instanceof Error ? err.message : String(err),
                      operatorId,
                      conversationId,
                    },
                    'emergency classifier threw unexpectedly (already swallowed inside service)',
                  );
                });
            }
          }

          // Suppress the AI advance loop only when a human currently owns
          // the conversation — i.e. there's an OPEN escalation row. Keying
          // off `conversation.status === 'escalated'` alone left rows stuck
          // when the escalation was resolved but the conversation status
          // wasn't flipped (race or older code path) — see QA 2026-05-12.
          const openEsc = await this.escalations.findOpenForConversation(convoFull.id);
          if (openEsc) {
            // Human is on it; the echo above already informed the team.
          } else if (!(await this.opening.hasBotMessage(convoFull.id))) {
            // Text-first contact: the caller texted the business number instead
            // of calling. Start the conversation exactly as a missed call does
            // (consent record + opening SMS with the STOP disclosure); the AI
            // picks up on their next reply and sees this first text in history.
            this.scheduleTextOpening({
              operator: operatorRow,
              conversationId: convoFull.id,
              callerPhoneE164: form.From,
              body: form.Body,
            });
          } else {
            // Debounce 2s — rapid-fire caller SMS bursts (common: "I need
            // someone" / "kitchen flood" / "08820") collapse into one advance
            // run that reads all turns at once. Prevents concurrent OpenAI
            // calls, contradictory replies, and §9.3 rate-limit drops on
            // the bot's second/third reply.
            const callerPhone = form.From;
            this.advanceScheduler.schedule(convoFull.id, () =>
              this.advance.advance({
                operator: operatorRow,
                conversation: convoFull,
                callerPhoneE164: callerPhone,
              }),
            );
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: msg, operatorId: operator.id }, 'advance/bridge failed; manual replay will be needed');
    }

    return this.emptyResponse();
  }

  /**
   * Opening for a text-first caller. Goes through the same per-conversation
   * debounce as the AI advance, so a burst ("hi" / "need a plumber") sends ONE
   * opening, and re-checks for a bot message right before sending in case a
   * call's opening (or another replica) got there first. A first text that is a
   * carrier keyword (STOP, HELP, START...) gets nothing: Twilio answers those.
   */
  private scheduleTextOpening(args: {
    operator: {
      id: string;
      business_name: string;
      category: string | null;
      twilio_number_e164: string | null;
    };
    conversationId: string;
    callerPhoneE164: string;
    body: string;
  }): void {
    const { operator, conversationId, callerPhoneE164, body } = args;
    if (isCarrierKeyword(body)) {
      this.advanceScheduler.cancel(conversationId);
      this.logger.info(
        { operatorId: operator.id, conversationId },
        'text-first contact was a carrier keyword; no opening sent',
      );
      return;
    }
    this.advanceScheduler.schedule(conversationId, async () => {
      if (await this.opening.hasBotMessage(conversationId)) return;
      await this.opening.recordConsent({
        operatorId: operator.id,
        callerPhoneE164,
        channel: 'text',
      });
      await this.opening.sendOpening({
        operator,
        conversationId,
        callerPhoneE164,
        channel: 'text',
      });
      this.logger.info({ operatorId: operator.id, conversationId }, 'text-first opening sent');
    });
  }

  /**
   * Empty TwiML — Twilio doesn't need a response body for SMS, but returning
   * empty `<Response/>` is the canonical way to ack without sending anything.
   * Outbound bot replies go via the Messaging API on the worker, not via TwiML.
   */
  private emptyResponse(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  }
}
