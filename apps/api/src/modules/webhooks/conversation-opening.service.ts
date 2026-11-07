import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import {
  SMS_INBOUND_CONSENT_TEXT,
  SMS_INBOUND_CONSENT_VERSION,
  VOICE_CONSENT_TEXT,
  VOICE_CONSENT_VERSION,
} from '../consent/sms-consent.dto';
import {
  openingSms,
  textOpeningSms,
  usageLimitOpeningSms,
} from '../conversations/templates/sms-templates';
import { ConversationsService } from '../conversations/conversations.service';
import { UsageService } from '../usage/usage.service';

/** How the caller first reached the operator. Picks the opening wording and consent record. */
export type OpeningChannel = 'call' | 'text';

export interface OpeningOperator {
  readonly id: string;
  readonly business_name: string;
  readonly category?: string | null;
  readonly twilio_number_e164: string | null;
}

/**
 * Carrier opt-out / help / opt-in keywords Twilio answers on its own (Advanced
 * Opt-Out defaults). A brand-new conversation that opens with one of these gets
 * no opening SMS: Twilio already replied, and after STOP a send would fail with
 * 21610 anyway. "YES" is deliberately absent; as a first text it's just a reply.
 */
const CARRIER_KEYWORDS: ReadonlySet<string> = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
  'OPTOUT',
  'REVOKE',
  'HELP',
  'INFO',
  'START',
  'UNSTOP',
]);

export function isCarrierKeyword(body: string): boolean {
  const word = body.trim().replace(/[.!]+$/, '').toUpperCase();
  return CARRIER_KEYWORDS.has(word);
}

/**
 * First-contact handling shared by the two ways a conversation can start: a
 * missed call (after the caller opts in on the IVR) and a caller texting the
 * business number first. Both record consent and send the same kind of opening
 * SMS, so the conversation that follows is identical either way.
 */
@Injectable()
export class ConversationOpeningService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly usage: UsageService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ConversationOpeningService.name);
  }

  /**
   * True once the conversation has ANY bot message, over its whole lifetime.
   * Deliberately not scoped to `started_at`: that is reset when a completed
   * conversation is reopened for a follow-up, and a follow-up must not get a
   * second opening.
   */
  async hasBotMessage(conversationId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .db()
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId)
      .eq('role', 'bot');
    if (error) throw error;
    return (count ?? 0) > 0;
  }

  /**
   * Send the first SMS of a conversation. It carries the A2P/CTIA opt-out
   * disclosure (PROGRESS.md Slice 16). A NEW caller on a plan at its limit gets
   * the polite "we'll follow up" text instead of the AI invite (#usage-metering).
   */
  async sendOpening(args: {
    operator: OpeningOperator;
    conversationId: string;
    callerPhoneE164: string;
    channel: OpeningChannel;
  }): Promise<void> {
    const { operator, conversationId, callerPhoneE164, channel } = args;
    if (!operator.twilio_number_e164) return;

    const admitted = await this.usage.wouldAdmit(operator.id, callerPhoneE164);
    const opening = !admitted
      ? usageLimitOpeningSms(operator.business_name)
      : channel === 'call'
        ? openingSms(operator.business_name, operator.category)
        : textOpeningSms(operator.business_name, operator.category);

    const send = await this.twilio.sendSms({
      from: operator.twilio_number_e164,
      to: callerPhoneE164,
      body: opening,
    });

    if ('sid' in send) {
      await this.conversations.appendMessage({
        conversationId,
        role: 'bot',
        body: opening,
        twilioMessageSid: send.sid,
      });
    } else {
      // Skipped (allowlist / opted out): still record it so the transcript
      // shows what we'd have sent, and so a later text isn't treated as first
      // contact again. Useful in dev/staging.
      await this.conversations.appendMessage({
        conversationId,
        role: 'bot',
        body: `[skipped: ${send.skipped}] ${opening}`,
      });
    }
  }

  /**
   * Durable proof of consent behind the first SMS. Call: verbal opt-in on the
   * IVR (`voice_ivr`). Text: the caller messaged us first (`sms_inbound`).
   * Best-effort: a failed insert is logged loudly but never blocks the reply
   * the caller asked for.
   */
  async recordConsent(args: {
    operatorId: string;
    callerPhoneE164: string;
    channel: OpeningChannel;
    /** Call only: how the caller affirmed, e.g. `pressed 1`. */
    affirmation?: string;
  }): Promise<void> {
    const row =
      args.channel === 'call'
        ? {
            source: 'voice_ivr',
            consent_version: VOICE_CONSENT_VERSION,
            consent_text: VOICE_CONSENT_TEXT,
            user_agent: `twilio-voice-ivr (${args.affirmation ?? 'affirmed'})`,
          }
        : {
            source: 'sms_inbound',
            consent_version: SMS_INBOUND_CONSENT_VERSION,
            consent_text: SMS_INBOUND_CONSENT_TEXT,
            user_agent: 'twilio-sms-inbound (caller texted first)',
          };
    const { error } = await this.supabase
      .db()
      .from('sms_consents')
      .insert({
        name: null,
        phone_e164: args.callerPhoneE164,
        trade: null,
        ip_address: null,
        ...row,
      });
    if (error) {
      this.logger.error(
        { err: error.message, operatorId: args.operatorId, channel: args.channel },
        'consent insert failed',
      );
    }
  }
}
