import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Tables } from '@bookingblues/db-types';
import { PinoLogger } from 'nestjs-pino';
import WebSocket from 'ws';

import { SupabaseService } from '../../common/supabase/supabase.service';
import { TwilioService } from '../../common/twilio/twilio.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AdvanceService } from '../ai/advance.service';
import { isOfficeAppointmentCategory } from '../ai/category-profile';
import { utcToLocalWallTime } from '../calendar/zoned-time';
import { ConversationsService } from '../conversations/conversations.service';
import { EscalationsService } from '../slack/escalations.service';
import { UsageService } from '../usage/usage.service';

import { realtimeToolsFor } from './realtime-tools';
import { latencyStats, type VoiceCallHooks } from './voice-bridge';
import {
  VOICE_AI_SMS_CONSENT_TEXT,
  VOICE_AI_SMS_CONSENT_VERSION,
  assembleVoiceInstructions,
  voiceGreeting,
} from './voice-prompt';
import { createVoiceToken, isVoiceAiEnabledFor } from './voice-session-token';

type OperatorRow = Tables<'operators'>;
type ConversationRow = Tables<'conversations'>;

/** Everything a call needs, built while Twilio is still connecting the stream. */
export interface PreparedCall {
  readonly callSid: string;
  readonly operator: OperatorRow;
  readonly conversation: ConversationRow;
  readonly callerPhoneE164: string;
  /** Already open, session already configured: no connect time on the first turn. */
  readonly openai: WebSocket;
  readonly greeting: string;
}

const GOOD_STANDING = new Set(['trialing', 'active']);
/** A prepared call nobody claimed (Twilio never opened the stream) is dropped after this. */
const UNCLAIMED_TTL_MS = 60_000;
const OPENAI_CONNECT_TIMEOUT_MS = 5_000;
export const VOICE_STREAM_PATH = '/webhooks/twilio/voice-stream';

/**
 * Voice AI spike: decides whether a missed call goes to a live AI conversation,
 * prepares it, and supplies the side effects the bridge needs. Single-replica
 * only (prepared calls live in memory and the stream must reach the same
 * process that answered the webhook). See docs/spikes/voice-ai-realtime.md.
 */
@Injectable()
export class VoiceCallService implements OnModuleDestroy {
  private readonly pending = new Map<
    string,
    { promise: Promise<PreparedCall>; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly twilio: TwilioService,
    private readonly conversations: ConversationsService,
    private readonly advance: AdvanceService,
    private readonly escalations: EscalationsService,
    private readonly usage: UsageService,
    private readonly logger: PinoLogger,
    @Inject(ENV_TOKEN) private readonly env: Env,
  ) {
    this.logger.setContext(VoiceCallService.name);
  }

  onModuleDestroy(): void {
    for (const { promise, timer } of this.pending.values()) {
      clearTimeout(timer);
      promise.then((p) => p.openai.close()).catch(() => undefined);
    }
    this.pending.clear();
  }

  /**
   * TwiML that connects the call to the voice bridge, or null to use the
   * existing press-1 IVR -> SMS flow (voice AI off for this operator, not in
   * good standing, at the plan limit, or a human owns the conversation).
   */
  async tryStart(args: {
    operatorId: string;
    callSid: string;
    callerPhoneE164: string;
  }): Promise<string | null> {
    const { operatorId, callSid, callerPhoneE164 } = args;
    if (!isVoiceAiEnabledFor(operatorId, this.env.VOICE_AI_OPERATOR_IDS)) return null;
    if (!this.env.OPENAI_API_KEY || !this.env.TWILIO_AUTH_TOKEN) {
      this.logger.error({ operatorId }, 'voice AI enabled but OPENAI_API_KEY / TWILIO_AUTH_TOKEN missing; using IVR');
      return null;
    }

    const { data: operator, error } = await this.supabase
      .db()
      .from('operators')
      .select('*')
      .eq('id', operatorId)
      .single();
    if (error) throw error;
    if (!operator.twilio_number_e164) return null;
    if (
      !operator.subscription_status ||
      !GOOD_STANDING.has(operator.subscription_status) ||
      operator.overage_unpaid_invoice_id
    ) {
      return null;
    }
    const admission = await this.usage.admitCaller(operator, callerPhoneE164);
    if (!admission.allowed) return null;

    const conversation = await this.conversations.getOrCreate(operatorId, callerPhoneE164, {
      resumeCompleted: false,
      freshIfBooked: true,
    });
    if (await this.escalations.findOpenForConversation(conversation.id)) return null;

    await this.conversations.appendMessage({
      conversationId: conversation.id,
      role: 'system',
      body: '[Voice call started with the AI assistant]',
    });

    // Not awaited: this runs while Twilio connects the media stream.
    const promise = this.prepare(callSid, operator, conversation, callerPhoneE164);
    promise.catch((err: Error) =>
      this.logger.error({ operatorId, callSid, err: err.message }, 'voice call prepare failed'),
    );
    const timer = setTimeout(() => {
      const entry = this.pending.get(callSid);
      this.pending.delete(callSid);
      entry?.promise.then((p) => p.openai.close()).catch(() => undefined);
    }, UNCLAIMED_TTL_MS);
    this.pending.set(callSid, { promise, timer });

    const token = createVoiceToken({ callSid, operatorId, secret: this.env.TWILIO_AUTH_TOKEN });
    const streamUrl = `${this.env.API_URL.replace(/^http/, 'ws')}${VOICE_STREAM_PATH}`;
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response><Connect><Stream url="${escapeAttr(streamUrl)}">` +
      `<Parameter name="token" value="${escapeAttr(token)}"/>` +
      `</Stream></Connect></Response>`
    );
  }

  /** The stream for this call connected: hand over the prepared session (once). */
  claim(callSid: string): Promise<PreparedCall> | null {
    const entry = this.pending.get(callSid);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.pending.delete(callSid);
    return entry.promise;
  }

  /** Send the call back through the voice webhook with voice AI skipped (press-1 IVR -> SMS). */
  async fallbackToIvr(callSid: string, operatorId: string, reason: string): Promise<void> {
    this.logger.error({ callSid, operatorId, reason }, 'voice AI failed; redirecting call to IVR -> SMS flow');
    await this.twilio
      .client()
      .calls(callSid)
      .update({ url: `${this.env.API_URL}/webhooks/twilio/voice/${operatorId}?fallback=1`, method: 'POST' });
  }

  hooksFor(prepared: PreparedCall): VoiceCallHooks {
    const { operator, callerPhoneE164, callSid } = prepared;
    let conversation = prepared.conversation;
    const ctx = () => this.advance.toolCtx(operator, conversation, callerPhoneE164);
    const slack = !isOfficeAppointmentCategory(operator.category);
    const base = { operatorId: operator.id, conversationId: conversation.id, callSid };

    return {
      dispatchTool: (name, rawArgs) => this.advance.dispatchTool(name, rawArgs, ctx()),
      applyTerminal: async (result) => {
        await this.advance.applyTerminal(conversation.id, result);
        if (result.state) conversation = { ...conversation, status: result.state };
      },
      recordSmsConsent: async () => {
        const { error } = await this.supabase
          .db()
          .from('sms_consents')
          .insert({
            name: null,
            phone_e164: callerPhoneE164,
            trade: null,
            source: 'voice_ai_verbal',
            consent_version: VOICE_AI_SMS_CONSENT_VERSION,
            consent_text: VOICE_AI_SMS_CONSENT_TEXT,
            ip_address: null,
            user_agent: `twilio-voice-ai (${callSid})`,
          });
        if (error) throw error;
      },
      sendSms: async (body) => {
        if (!operator.twilio_number_e164) return;
        const send = await this.twilio.sendSms({ from: operator.twilio_number_e164, to: callerPhoneE164, body });
        await this.conversations.appendMessage({
          conversationId: conversation.id,
          role: 'bot',
          body: 'sid' in send ? body : `[skipped: ${send.skipped}] ${body}`,
          ...('sid' in send ? { twilioMessageSid: send.sid } : {}),
        });
      },
      saveTranscript: async (role, text) => {
        await this.conversations.appendMessage({ conversationId: conversation.id, role, body: text });
        if (!slack) return;
        if (role === 'caller') {
          await this.escalations.echoCallerMessageToConversationThread({
            conversation,
            body: `(on call) ${text}`,
          });
        } else {
          await this.escalations.postConversationThreadAlert({
            operator,
            conversation,
            text: `Bot (on call): ${text}`,
          });
        }
      },
      startRecording: async () => {
        if (!this.env.VOICE_RECORD_CALLS) return;
        const rec = await this.twilio.client().calls(callSid).recordings.create({ recordingChannels: 'dual' });
        await this.conversations.appendMessage({
          conversationId: conversation.id,
          role: 'system',
          body: `[Call recording started: ${rec.sid}]`,
        });
      },
      hangup: async () => {
        await this.twilio.client().calls(callSid).update({ status: 'completed' });
      },
      fallbackToIvr: async (reason) => {
        await this.fallbackToIvr(callSid, operator.id, reason);
        if (slack) {
          await this.escalations.postConversationThreadAlert({
            operator,
            conversation,
            text: `:rotating_light: Voice AI dropped mid-call (${reason}). Caller was sent to the press-1 text flow.`,
          });
        }
      },
      onEnded: async (summary) => {
        this.logger.info(
          { ...base, ...summary, latenciesMs: undefined, latency: latencyStats(summary.latenciesMs) },
          'voice call ended',
        );
        await this.conversations.appendMessage({
          conversationId: conversation.id,
          role: 'system',
          body: `[Voice call ended after ${summary.durationSec}s]`,
        });
        if (!summary.terminal) {
          // The caller can keep going by text; the next SMS resumes this conversation.
          await this.supabase
            .db()
            .from('conversations')
            .update({ status: 'awaiting_caller' })
            .eq('id', conversation.id);
        }
      },
      log: (level, fields, msg) => this.logger[level]({ ...base, ...fields }, msg),
    };
  }

  // ── preparation ─────────────────────────────────────────────────────────

  private async prepare(
    callSid: string,
    operator: OperatorRow,
    conversation: ConversationRow,
    callerPhoneE164: string,
  ): Promise<PreparedCall> {
    const started = Date.now();
    const [openai, basePrompt, recentTexts, availability, freshConversation] = await Promise.all([
      this.connectOpenAI(),
      this.advance.buildSystemPrompt(operator, conversation.id, callerPhoneE164),
      this.recentTexts(conversation.id),
      this.preloadAvailability(operator, conversation, callerPhoneE164),
      this.openSlackThread(operator, conversation),
    ]);

    const instructions = assembleVoiceInstructions({
      baseSystemPrompt: basePrompt,
      recentTexts,
      preloadedAvailability: availability,
    });
    openai.send(JSON.stringify(this.sessionUpdate(operator.category, instructions)));
    this.logger.info(
      { callSid, operatorId: operator.id, conversationId: conversation.id, prepareMs: Date.now() - started },
      'voice call prepared',
    );
    return {
      callSid,
      operator,
      conversation: freshConversation,
      callerPhoneE164,
      openai,
      greeting: voiceGreeting(operator.business_name),
    };
  }

  private sessionUpdate(category: string | null, instructions: string): Record<string, unknown> {
    const env = this.env;
    const turnDetection =
      env.VOICE_TURN_DETECTION === 'semantic_vad'
        ? { type: 'semantic_vad', eagerness: env.VOICE_VAD_EAGERNESS }
        : {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: env.VOICE_VAD_SILENCE_MS,
          };
    return {
      type: 'session.update',
      session: {
        type: 'realtime',
        model: env.OPENAI_REALTIME_MODEL,
        output_modalities: ['audio'],
        instructions,
        audio: {
          input: {
            // Twilio's native phone audio (8kHz G.711 mu-law): passed through, no transcoding.
            format: { type: 'audio/pcmu' },
            transcription: { model: env.OPENAI_REALTIME_TRANSCRIBE_MODEL },
            turn_detection: turnDetection,
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: env.OPENAI_REALTIME_VOICE,
          },
        },
        tools: realtimeToolsFor(category),
        tool_choice: 'auto',
      },
    };
  }

  private connectOpenAI(): Promise<WebSocket> {
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.env.OPENAI_REALTIME_MODEL)}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` } });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('OpenAI realtime connect timed out'));
      }, OPENAI_CONNECT_TIMEOUT_MS);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /** Calendar snapshot for the next week, so the first "what's open?" needs no tool call. */
  private async preloadAvailability(
    operator: OperatorRow,
    conversation: ConversationRow,
    callerPhoneE164: string,
  ): Promise<string | null> {
    try {
      const now = new Date();
      const tz = operator.timezone;
      const result = await this.advance.dispatchTool(
        'check_availability',
        JSON.stringify({
          window_start: utcToLocalWallTime(now.toISOString(), tz),
          window_end: utcToLocalWallTime(new Date(now.getTime() + 7 * 86_400_000).toISOString(), tz),
        }),
        this.advance.toolCtx(operator, conversation, callerPhoneE164),
      );
      return JSON.stringify(result.content);
    } catch (err) {
      this.logger.warn({ operatorId: operator.id, err: (err as Error).message }, 'availability preload failed');
      return null;
    }
  }

  /** Texts already in this conversation (the caller texted before calling). */
  private async recentTexts(conversationId: string): Promise<string | null> {
    const { data } = await this.supabase
      .db()
      .from('messages')
      .select('role, body')
      .eq('conversation_id', conversationId)
      .in('role', ['caller', 'bot'])
      .order('created_at', { ascending: false })
      .limit(12);
    if (!data || data.length === 0) return null;
    return data
      .reverse()
      .map((m) => `${m.role === 'caller' ? 'Caller' : 'Assistant'}: ${m.body}`)
      .join('\n');
  }

  private async openSlackThread(operator: OperatorRow, conversation: ConversationRow): Promise<ConversationRow> {
    if (isOfficeAppointmentCategory(operator.category)) return conversation;
    try {
      const { channelId, threadTs } = await this.escalations.ensureConversationThread({ operator, conversation });
      if (!threadTs) return conversation;
      return { ...conversation, slack_channel_id: channelId, slack_thread_ts: threadTs } as ConversationRow;
    } catch (err) {
      this.logger.warn({ conversationId: conversation.id, err: (err as Error).message }, 'convos thread open failed');
      return conversation;
    }
  }
}

function escapeAttr(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
