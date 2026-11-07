import type { ToolResult } from '../ai/tool-handlers';

/**
 * One live call: Twilio Media Stream <-> OpenAI Realtime.
 *
 * Audio goes straight through in both directions (8kHz mu-law on both sides, so
 * no transcoding). The bridge handles:
 *   - barge-in: when the caller starts talking over the bot, Twilio's buffered
 *     audio is cleared and OpenAI is told how much of its reply was heard;
 *   - tool calls, through the same dispatcher the SMS bot uses;
 *   - the AI/recording disclosure, which plays before the caller's audio is
 *     forwarded at all, so it can't be talked over;
 *   - per-turn latency: caller stops talking -> first byte of bot audio.
 *
 * Side effects (DB, Twilio REST, Slack) live behind VoiceCallHooks so this
 * class is testable with fake sockets.
 */

export interface BridgeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

/** WebSocket.OPEN */
const OPEN = 1;

export interface VoiceCallHooks {
  dispatchTool(name: string, rawArgs: string): Promise<ToolResult>;
  applyTerminal(result: ToolResult): Promise<void>;
  recordSmsConsent(): Promise<void>;
  sendSms(body: string): Promise<void>;
  saveTranscript(role: 'caller' | 'bot', text: string): Promise<void>;
  startRecording(): Promise<void>;
  hangup(): Promise<void>;
  /** OpenAI failed mid-call: hand the caller to the old IVR -> SMS flow. */
  fallbackToIvr(reason: string): Promise<void>;
  onEnded(summary: CallSummary): Promise<void>;
  log(level: 'info' | 'warn' | 'error', fields: Record<string, unknown>, msg: string): void;
}

export interface CallSummary {
  readonly durationSec: number;
  readonly callerTurns: number;
  readonly latenciesMs: readonly number[];
  readonly terminal: boolean;
  readonly endedBy: 'bot' | 'caller_or_network' | 'time_limit' | 'error';
}

interface PendingCall {
  readonly name: string;
  readonly callId: string;
  readonly args: string;
}

type Json = Record<string, unknown>;

export class VoiceBridge {
  private streamSid: string | null = null;
  /** Twilio media timestamp (ms since stream start) of the latest caller frame. */
  private latestMediaTs = 0;
  /** Media timestamp when the current bot reply started playing. */
  private responseStartTs: number | null = null;
  private lastAssistantItem: string | null = null;
  private readonly markQueue: string[] = [];
  private responseInProgress = false;
  private pendingCalls: PendingCall[] = [];

  /** Caller audio is not forwarded until the greeting (with disclosures) has fully played. */
  private listening = false;
  private greetingDone = false;
  private endAfterSpeech = false;
  private endedBy: CallSummary['endedBy'] = 'caller_or_network';
  private terminal = false;
  private finished = false;

  private speechStoppedAt: number | null = null;
  private readonly latenciesMs: number[] = [];
  private callerTurns = 0;
  private readonly startedAt = Date.now();
  private timeLimit: NodeJS.Timeout | null = null;

  constructor(
    private readonly twilio: BridgeSocket,
    private readonly openai: BridgeSocket,
    private readonly hooks: VoiceCallHooks,
    private readonly opts: { greeting: string; maxCallSeconds: number },
  ) {}

  /** Twilio sent `start`: the stream is live. Speak the greeting. */
  start(streamSid: string): void {
    this.streamSid = streamSid;
    this.sendOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              '(The phone call just connected. Greet the caller now by saying exactly this, ' +
              `word for word, then stop and listen: "${this.opts.greeting}")`,
          },
        ],
      },
    });
    this.sendOpenAI({ type: 'response.create' });
    this.timeLimit = setTimeout(() => this.onTimeLimit(), this.opts.maxCallSeconds * 1000);
  }

  // ── Twilio -> bridge ────────────────────────────────────────────────────

  onTwilioMessage(raw: string): void {
    let msg: Json;
    try {
      msg = JSON.parse(raw) as Json;
    } catch {
      return;
    }
    switch (msg.event) {
      case 'media': {
        const media = msg.media as { timestamp?: string; payload?: string } | undefined;
        if (media?.timestamp) this.latestMediaTs = Number(media.timestamp);
        if (this.listening && media?.payload) {
          this.sendOpenAI({ type: 'input_audio_buffer.append', audio: media.payload });
        }
        break;
      }
      case 'mark':
        this.markQueue.shift();
        this.maybeFinishSpeaking();
        break;
      case 'stop':
        void this.finish();
        break;
      default:
        break;
    }
  }

  onTwilioClose(): void {
    void this.finish();
  }

  // ── OpenAI -> bridge ────────────────────────────────────────────────────

  onOpenAIMessage(raw: string): void {
    let evt: Json;
    try {
      evt = JSON.parse(raw) as Json;
    } catch {
      return;
    }
    const type = String(evt.type ?? '');
    switch (type) {
      case 'response.created':
        this.responseInProgress = true;
        break;

      // GA name, plus the beta name in case the model is pinned to the beta API.
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        this.onAudioDelta(String(evt.delta ?? ''), String(evt.item_id ?? ''));
        break;

      case 'input_audio_buffer.speech_started':
        this.onCallerStartedTalking();
        break;

      case 'input_audio_buffer.speech_stopped':
        this.speechStoppedAt = Date.now();
        break;

      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(evt.transcript ?? '').trim();
        if (text) {
          this.callerTurns += 1;
          void this.safe(() => this.hooks.saveTranscript('caller', text), 'save caller transcript');
        }
        break;
      }

      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done': {
        const text = String(evt.transcript ?? '').trim();
        if (text) void this.safe(() => this.hooks.saveTranscript('bot', text), 'save bot transcript');
        break;
      }

      case 'response.function_call_arguments.done':
        this.pendingCalls.push({
          name: String(evt.name ?? ''),
          callId: String(evt.call_id ?? ''),
          args: String(evt.arguments ?? '{}'),
        });
        break;

      case 'response.done':
        this.responseInProgress = false;
        void this.onResponseDone();
        break;

      case 'error': {
        const err = (evt.error ?? {}) as { type?: string; code?: string; message?: string };
        // Truncating past the end of the audio is harmless (caller interrupted
        // right at the end); everything else is worth seeing.
        const level = err.code === 'invalid_value' ? 'warn' : 'error';
        this.hooks.log(level, { code: err.code, type: err.type, message: err.message }, 'realtime error event');
        break;
      }
      default:
        break;
    }
  }

  onOpenAIClose(): void {
    if (this.finished) return;
    this.endedBy = 'error';
    this.hooks.log('error', {}, 'OpenAI realtime socket closed mid-call; falling back to IVR');
    void this.safe(() => this.hooks.fallbackToIvr('openai_socket_closed'), 'fallback to IVR').then(() =>
      this.finish(),
    );
  }

  // ── internals ───────────────────────────────────────────────────────────

  private onAudioDelta(delta: string, itemId: string): void {
    if (!delta || !this.streamSid) return;
    if (this.speechStoppedAt !== null) {
      const latency = Date.now() - this.speechStoppedAt;
      this.latenciesMs.push(latency);
      this.hooks.log('info', { latencyMs: latency, turn: this.latenciesMs.length }, 'voice turn latency');
      this.speechStoppedAt = null;
    }
    if (this.responseStartTs === null) this.responseStartTs = this.latestMediaTs;
    if (itemId) this.lastAssistantItem = itemId;
    this.sendTwilio({ event: 'media', streamSid: this.streamSid, media: { payload: delta } });
    // A mark per chunk: Twilio echoes it back once that audio has played, so an
    // empty queue means the caller has heard everything we sent.
    const name = `r${this.markQueue.length}`;
    this.markQueue.push(name);
    this.sendTwilio({ event: 'mark', streamSid: this.streamSid, mark: { name } });
  }

  private onCallerStartedTalking(): void {
    if (this.markQueue.length === 0 || this.responseStartTs === null || !this.lastAssistantItem) return;
    const heardMs = Math.max(0, this.latestMediaTs - this.responseStartTs);
    this.sendOpenAI({
      type: 'conversation.item.truncate',
      item_id: this.lastAssistantItem,
      content_index: 0,
      audio_end_ms: heardMs,
    });
    if (this.streamSid) this.sendTwilio({ event: 'clear', streamSid: this.streamSid });
    this.markQueue.length = 0;
    this.lastAssistantItem = null;
    this.responseStartTs = null;
  }

  private async onResponseDone(): Promise<void> {
    if (this.pendingCalls.length > 0) {
      const calls = this.pendingCalls;
      this.pendingCalls = [];
      let hangUpNow = false;
      for (const call of calls) {
        const { output, hangUp } = await this.runTool(call);
        hangUpNow = hangUpNow || hangUp;
        this.sendOpenAI({
          type: 'conversation.item.create',
          item: { type: 'function_call_output', call_id: call.callId, output: JSON.stringify(output) },
        });
      }
      if (hangUpNow) {
        this.endedBy = 'bot';
        await this.safe(() => this.hooks.hangup(), 'hangup');
        return;
      }
      this.sendOpenAI({ type: 'response.create' });
      return;
    }
    this.maybeFinishSpeaking();
  }

  /** Called when a reply finishes generating or a mark comes back. */
  private maybeFinishSpeaking(): void {
    if (this.responseInProgress || this.markQueue.length > 0) return;
    this.responseStartTs = null;
    if (!this.greetingDone) {
      this.greetingDone = true;
      this.listening = true;
      // Disclosure has been heard; start recording now.
      void this.safe(() => this.hooks.startRecording(), 'start recording');
      return;
    }
    if (this.endAfterSpeech && !this.finished) {
      this.endAfterSpeech = false;
      if (this.endedBy === 'caller_or_network') this.endedBy = 'bot';
      void this.safe(() => this.hooks.hangup(), 'hangup');
    }
  }

  private async runTool(call: PendingCall): Promise<{ output: unknown; hangUp: boolean }> {
    if (call.name === 'record_sms_consent') {
      await this.safe(() => this.hooks.recordSmsConsent(), 'record sms consent');
      return { output: { recorded: true }, hangUp: false };
    }
    if (call.name === 'end_call') {
      this.endAfterSpeech = true;
      return {
        output: { ok: true, voice_instruction: 'If you have not said goodbye yet, say a short goodbye now.' },
        hangUp: false,
      };
    }

    let result: ToolResult;
    try {
      result = await this.hooks.dispatchTool(call.name, call.args);
    } catch (err) {
      this.hooks.log('error', { tool: call.name, err: (err as Error).message }, 'voice tool failed');
      return {
        output: {
          error: 'tool_failed',
          voice_instruction:
            'Something went wrong on our side. Apologize briefly and offer to have someone call them back.',
        },
        hangUp: false,
      };
    }

    let instruction: string | undefined;
    if (result.state) {
      this.terminal = true;
      await this.safe(() => this.hooks.applyTerminal(result), 'apply terminal state');
      if (result.silentTerminate) return { output: result.content, hangUp: true };
      this.endAfterSpeech = true;
      instruction =
        result.state === 'escalated'
          ? 'Tell the caller someone from the team will call them back shortly, then say goodbye.'
          : result.outboundMessage
            ? `Say this to the caller in your own words, then say goodbye: ${result.outboundMessage}`
            : 'Wrap up the call politely and say goodbye.';
    } else if (result.outboundMessage) {
      if (/https?:\/\//.test(result.outboundMessage)) {
        // Links can't be spoken; they go out by text.
        await this.safe(() => this.hooks.sendSms(result.outboundMessage!), 'send link sms');
        instruction = 'A text with the link was just sent to the caller. Tell them to check their messages.';
      } else {
        instruction = `Say this to the caller in your own words: ${result.outboundMessage}`;
      }
    }

    const output =
      instruction === undefined
        ? result.content
        : typeof result.content === 'object' && result.content !== null
          ? { ...(result.content as Json), voice_instruction: instruction }
          : { result: result.content, voice_instruction: instruction };
    return { output, hangUp: false };
  }

  private onTimeLimit(): void {
    if (this.finished) return;
    this.endedBy = 'time_limit';
    this.hooks.log('warn', { maxCallSeconds: this.opts.maxCallSeconds }, 'voice call hit time limit');
    void this.safe(
      async () => {
        const result = await this.hooks.dispatchTool(
          'escalate_to_human',
          JSON.stringify({ reason: 'turn_cap: voice call time limit reached' }),
        );
        this.terminal = true;
        await this.hooks.applyTerminal(result);
      },
      'escalate on time limit',
    );
    this.endAfterSpeech = true;
    this.sendOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text:
              '(System: the call time limit has been reached. Tell the caller someone from the ' +
              'team will call them back shortly, then say goodbye. Do not call any tools.)',
          },
        ],
      },
    });
    this.sendOpenAI({ type: 'response.create' });
  }

  private async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.timeLimit) clearTimeout(this.timeLimit);
    if (this.openai.readyState === OPEN) this.openai.close();
    const summary: CallSummary = {
      durationSec: Math.round((Date.now() - this.startedAt) / 1000),
      callerTurns: this.callerTurns,
      latenciesMs: this.latenciesMs,
      terminal: this.terminal,
      endedBy: this.endedBy,
    };
    await this.safe(() => this.hooks.onEnded(summary), 'on call ended');
  }

  private sendOpenAI(payload: Json): void {
    // Requesting a reply counts as "speaking" from now, not from response.created:
    // a late playback mark in between must not look like the bot went quiet
    // (that would hang up before the goodbye plays).
    if (payload.type === 'response.create') this.responseInProgress = true;
    if (this.openai.readyState === OPEN) this.openai.send(JSON.stringify(payload));
  }

  private sendTwilio(payload: Json): void {
    if (this.twilio.readyState === OPEN) this.twilio.send(JSON.stringify(payload));
  }

  private async safe(fn: () => Promise<unknown>, what: string): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.hooks.log('error', { err: (err as Error).message, step: what }, 'voice bridge step failed');
    }
  }
}

/** p50 / p90 / max of a latency list, for the end-of-call log line. */
export function latencyStats(ms: readonly number[]): { p50: number; p90: number; max: number } | null {
  if (ms.length === 0) return null;
  const sorted = [...ms].sort((a, b) => a - b);
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return { p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1]! };
}
