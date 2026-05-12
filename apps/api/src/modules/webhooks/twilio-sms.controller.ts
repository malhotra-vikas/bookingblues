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
import { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AdvanceSchedulerService } from '../ai/advance-scheduler.service';
import { AdvanceService } from '../ai/advance.service';
import { ConversationsService } from '../conversations/conversations.service';
import { EscalationsService } from '../slack/escalations.service';
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
    private readonly advance: AdvanceService,
    private readonly advanceScheduler: AdvanceSchedulerService,
    private readonly escalations: EscalationsService,
    private readonly idempotency: WebhookIdempotencyService,
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
    if (recorded.status === 'duplicate') return this.emptyResponse();

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

          // Suppress the AI advance loop only when a human currently owns
          // the conversation — i.e. there's an OPEN escalation row. Keying
          // off `conversation.status === 'escalated'` alone left rows stuck
          // when the escalation was resolved but the conversation status
          // wasn't flipped (race or older code path) — see QA 2026-05-12.
          const openEsc = await this.escalations.findOpenForConversation(convoFull.id);
          if (openEsc) {
            // Human is on it; the echo above already informed the team.
          } else {
            // Debounce 2s — rapid-fire caller SMS bursts (common: "I need a
            // plumber" / "kitchen flood" / "08820") collapse into one advance
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
   * Empty TwiML — Twilio doesn't need a response body for SMS, but returning
   * empty `<Response/>` is the canonical way to ack without sending anything.
   * Outbound bot replies go via the Messaging API on the worker, not via TwiML.
   */
  private emptyResponse(): string {
    return `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  }
}
