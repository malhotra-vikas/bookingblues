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
import { AdvanceService } from '../ai/advance.service';
import { ConversationsService } from '../conversations/conversations.service';
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

    // Best-effort advance. Failures here (missing OPENAI_API_KEY in dev,
    // OpenAI 5xx, calendar issues) are logged but do not fail the Twilio
    // webhook — Twilio would retry-loop and we'd duplicate the inbound. A
    // future pg-boss queue (CLAUDE.md §6) will own retry semantics.
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
          await this.advance.advance({
            operator: operatorRow,
            conversation: convoFull,
            callerPhoneE164: form.From,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: msg, operatorId: operator.id }, 'advance failed; manual replay will be needed');
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
