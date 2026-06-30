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
import { VOICE_CONSENT_TEXT, VOICE_CONSENT_VERSION } from '../consent/sms-consent.dto';
import { openingSms } from '../conversations/templates/sms-templates';
import { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { ConversationsService } from '../conversations/conversations.service';
import {
  callerConsentedFromGather,
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

interface TwilioVoiceConsentForm extends TwilioVoiceForm {
  /** DTMF keypad input from <Gather>. '1' = affirmative consent. */
  readonly Digits?: string;
  /** Transcribed speech from <Gather input="speech">, e.g. "yes". */
  readonly SpeechResult?: string;
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

    // No side effects here: A2P 10DLC requires affirmative opt-in before we
    // text. We disclose + ask the caller to press 1 / say yes; the SMS is only
    // sent from the /consent callback once they affirm.
    return this.consentGatherTwiml(operator.id, operator.business_name);
  }

  /**
   * <Gather> action target. Twilio POSTs the caller's DTMF/speech here. We text
   * only on an affirmative ("1" or "yes"); otherwise we end the call politely
   * and send nothing.
   */
  @Post(':operatorId/consent')
  @HttpCode(200)
  @Header('content-type', 'text/xml')
  async consent(
    @Req() req: Request,
    @Param('operatorId') operatorId: string,
    @Body() form: TwilioVoiceConsentForm,
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

    if (!callerConsentedFromGather(form.Digits, form.SpeechResult)) {
      this.logger.info({ operatorId: operator.id }, 'voice: caller declined SMS opt-in');
      return this.declineTwiml();
    }

    if (form.CallSid) {
      const recorded = await this.idempotency.record({
        source: 'twilio',
        eventId: form.CallSid,
        payload: form as unknown as Json,
        signatureVerified: true,
      });
      if (recorded.status === 'duplicate') {
        return this.confirmTwiml();
      }
      try {
        await this.recordVoiceConsent(operator.id, form);
        await this.startConversationFromCall(operator, form.From);
        await this.idempotency.markProcessed(recorded.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.idempotency.markFailed(recorded.id, msg);
        // Caller still hears the confirmation; a worker can retry side effects.
        this.logger.error({ err: msg, operatorId: operator.id }, 'voice side-effect failed');
      }
    }

    return this.confirmTwiml();
  }

  /** Spoken disclosure + affirmative prompt; <Gather> posts to the /consent callback. */
  private consentGatherTwiml(operatorId: string, businessName: string): string {
    const disclosure = VOICE_CONSENT_TEXT.replace('[business name]', businessName);
    const action = `${this.env.API_URL}/webhooks/twilio/voice/${operatorId}/consent`;
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Gather input="dtmf speech" numDigits="1" timeout="6" speechTimeout="auto" ` +
      `language="en-US" hints="yes, yeah, yep, sure, okay, correct" ` +
      `actionOnEmptyResult="true" method="POST" action="${escapeXml(action)}">` +
      `<Say voice="Polly.Joanna">${escapeXml(disclosure)}</Say>` +
      `</Gather>` +
      `</Response>`
    );
  }

  private confirmTwiml(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Say voice="Polly.Joanna">Great! We will text you right now to help get you scheduled. ` +
      `Talk soon.</Say>` +
      `<Hangup/>` +
      `</Response>`
    );
  }

  private declineTwiml(): string {
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Say voice="Polly.Joanna">No problem, we will not text you. ` +
      `If you change your mind, just call again. Goodbye.</Say>` +
      `<Hangup/>` +
      `</Response>`
    );
  }

  /**
   * Persist durable proof of verbal opt-in (source 'voice_ivr'). Stores the
   * exact disclosure the caller heard + how they affirmed. Best-effort row:
   * the disclosure text is also the carrier-submitted transcript, so this is
   * the audit trail behind that claim. `name` is null for voice (no name
   * collected) — see migration 20260623000001.
   */
  private async recordVoiceConsent(
    operatorId: string,
    form: TwilioVoiceConsentForm,
  ): Promise<void> {
    if (!form.From) return;
    const affirmation =
      form.Digits?.trim() === '1' ? 'pressed 1' : `said "${form.SpeechResult ?? ''}"`;
    const { error } = await this.supabase
      .db()
      .from('sms_consents')
      .insert({
        name: null,
        phone_e164: form.From,
        trade: null,
        source: 'voice_ivr',
        consent_version: VOICE_CONSENT_VERSION,
        consent_text: VOICE_CONSENT_TEXT,
        ip_address: null,
        user_agent: `twilio-voice-ivr (${affirmation})`,
      });
    if (error) {
      // Loud, but don't block the SMS the caller just consented to.
      this.logger.error(
        { err: error.message, operatorId },
        'voice: verbal consent insert failed',
      );
    }
  }

  private async startConversationFromCall(
    operator: { id: string; business_name: string; twilio_number_e164: string | null },
    callerPhone: string | undefined,
  ): Promise<void> {
    if (!callerPhone || !operator.twilio_number_e164) return;
    // A new inbound call is a new job — never reopen a just-completed convo
    // (the resume window is for SMS follow-ups only), and never continue a
    // conversation that already produced a confirmed booking (it's only open
    // to collect the address). See ConversationsService. `escalated` is the
    // one exception and is handled there.
    const convo = await this.conversations.getOrCreate(operator.id, callerPhone, {
      resumeCompleted: false,
      freshIfBooked: true,
    });
    // A2P 10DLC requires the first message in any conversation to disclose
    // opt-out + message-rate language (CTIA + carrier guidelines). Twilio
    // enforces STOP/UNSTOP automatically once a recipient sends those words;
    // we just need the human-readable disclosure on the first turn.
    // PROGRESS.md Slice 16(15). Template carries the disclosure.
    const opening = openingSms(operator.business_name);

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
