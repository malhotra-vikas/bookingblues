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
import { ConversationsService } from '../conversations/conversations.service';
import {
  escapeXml,
  resolveOperatorForWebhook,
  verifyTwilioSignature,
} from './twilio-helpers';

interface TwilioVoiceForm {
  readonly CallSid?: string;
  readonly From?: string;
  readonly To?: string;
  readonly [k: string]: string | undefined;
}

@Controller('webhooks/twilio/voice')
@SkipThrottle()
export class TwilioVoiceController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly idempotency: WebhookIdempotencyService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(TwilioVoiceController.name);
  }

  @Post(':operatorId')
  @HttpCode(200)
  @Header('content-type', 'text/xml')
  async handle(
    @Req() req: Request,
    @Param('operatorId') operatorId: string,
    @Body() form: TwilioVoiceForm,
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

    if (form.CallSid) {
      const recorded = await this.idempotency.record({
        source: 'twilio',
        eventId: form.CallSid,
        payload: form as unknown as Json,
        signatureVerified: true,
      });
      if (recorded.status === 'duplicate') {
        return this.greetingTwiml(operator.business_name);
      }
      try {
        await this.startConversationFromCall(operator, form.From);
        await this.idempotency.markProcessed(recorded.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.idempotency.markFailed(recorded.id, msg);
        // Fall through to TwiML — the caller still gets the greeting; a queue
        // worker (Slice 7) can retry the conversation/SMS side effects later.
        this.logger.error({ err: msg, operatorId: operator.id }, 'voice side-effect failed');
      }
    }

    return this.greetingTwiml(operator.business_name);
  }

  private greetingTwiml(businessName: string): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Say voice="Polly.Joanna">Thanks for calling ${escapeXml(businessName)}. ` +
      `They are with another customer. We will text you right away to schedule.</Say>` +
      `<Hangup/>` +
      `</Response>`
    );
  }

  private async startConversationFromCall(
    operator: { id: string; business_name: string; twilio_number_e164: string | null },
    callerPhone: string | undefined,
  ): Promise<void> {
    if (!callerPhone || !operator.twilio_number_e164) return;
    const convo = await this.conversations.getOrCreate(operator.id, callerPhone);
    // A2P 10DLC requires the first message in any conversation to disclose
    // opt-out + message-rate language (CTIA + carrier guidelines). Twilio
    // enforces STOP/UNSTOP automatically once a recipient sends those words;
    // we just need the human-readable disclosure on the first turn.
    // PROGRESS.md Slice 16(15).
    const opening = `Hi! Thanks for calling ${operator.business_name}. What can we help with today? Reply here and we'll get you on the schedule. Reply STOP to opt out. Msg & data rates may apply.`;

    const send = await this.twilio.sendSms({
      from: operator.twilio_number_e164,
      to: callerPhone,
      body: opening,
    });

    if ('sid' in send) {
      await this.conversations.appendMessage({
        conversationId: convo.id,
        role: 'bot',
        body: opening,
        twilioMessageSid: send.sid,
      });
    } else {
      // Skipped by allowlist — still record the message so the conversation
      // shows what we'd send. Useful in dev/staging.
      await this.conversations.appendMessage({
        conversationId: convo.id,
        role: 'bot',
        body: `[skipped: ${send.skipped}] ${opening}`,
      });
    }
  }
}
