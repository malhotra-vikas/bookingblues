import type { ToolResult } from '../ai/tool-handlers';

import { latencyStats, VoiceBridge, type BridgeSocket, type VoiceCallHooks } from './voice-bridge';

class FakeSocket implements BridgeSocket {
  readyState = 1;
  readonly sent: Array<Record<string, unknown>> = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  ofType(type: string): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type === type || m.event === type);
  }
  clear(): void {
    this.sent.length = 0;
  }
}

function makeHooks(dispatch?: (name: string, args: string) => ToolResult) {
  const hooks = {
    dispatchTool: jest.fn(async (name: string, args: string) =>
      dispatch ? dispatch(name, args) : ({ content: { ok: true } } as ToolResult),
    ),
    applyTerminal: jest.fn().mockResolvedValue(undefined),
    recordSmsConsent: jest.fn().mockResolvedValue(undefined),
    sendSms: jest.fn().mockResolvedValue(undefined),
    saveTranscript: jest.fn().mockResolvedValue(undefined),
    startRecording: jest.fn().mockResolvedValue(undefined),
    hangup: jest.fn().mockResolvedValue(undefined),
    fallbackToIvr: jest.fn().mockResolvedValue(undefined),
    onEnded: jest.fn().mockResolvedValue(undefined),
    log: jest.fn(),
  };
  return hooks as typeof hooks & VoiceCallHooks;
}

const GREETING = "Thanks for calling Zeus Plumbing. You're speaking with an AI assistant, and this call is recorded.";

function setup(dispatch?: (name: string, args: string) => ToolResult) {
  const twilio = new FakeSocket();
  const openai = new FakeSocket();
  const hooks = makeHooks(dispatch);
  const bridge = new VoiceBridge(twilio, openai, hooks, { greeting: GREETING, maxCallSeconds: 600 });
  const fromOpenAI = (evt: Record<string, unknown>) => bridge.onOpenAIMessage(JSON.stringify(evt));
  const fromTwilio = (evt: Record<string, unknown>) => bridge.onTwilioMessage(JSON.stringify(evt));
  const media = (ts: number) => fromTwilio({ event: 'media', media: { timestamp: String(ts), payload: 'AAAA' } });
  /** Bot speaks one chunk, finishes generating, and Twilio confirms it played. */
  const botSays = async (itemId = 'item_x') => {
    fromOpenAI({ type: 'response.created' });
    fromOpenAI({ type: 'response.output_audio.delta', delta: 'BBBB', item_id: itemId });
    fromOpenAI({ type: 'response.done' });
    await flush();
    const marks = twilio.ofType('mark');
    for (let i = 0; i < marks.length; i += 1) fromTwilio({ event: 'mark', mark: { name: 'r' } });
    twilio.clear();
    await flush();
  };
  return { twilio, openai, hooks, bridge, fromOpenAI, fromTwilio, media, botSays };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('VoiceBridge', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('speaks the disclosure greeting first, and ignores caller audio until it has played', async () => {
    const { bridge, openai, hooks, media, botSays } = setup();
    bridge.start('MZ1');

    const item = openai.ofType('conversation.item.create')[0] as { item: { content: Array<{ text: string }> } };
    expect(item.item.content[0]!.text).toContain(GREETING);
    expect(openai.ofType('response.create')).toHaveLength(1);

    media(100); // caller talks over the disclosure
    expect(openai.ofType('input_audio_buffer.append')).toHaveLength(0);

    await botSays('greet');
    expect(hooks.startRecording).toHaveBeenCalledTimes(1);

    media(5000);
    expect(openai.ofType('input_audio_buffer.append')).toHaveLength(1);
  });

  it('forwards bot audio to Twilio with a playback mark, and measures turn latency', async () => {
    const { bridge, twilio, hooks, fromOpenAI, botSays } = setup();
    bridge.start('MZ1');
    await botSays('greet');

    fromOpenAI({ type: 'input_audio_buffer.speech_stopped' });
    jest.advanceTimersByTime(640);
    fromOpenAI({ type: 'response.output_audio.delta', delta: 'CCCC', item_id: 'i2' });

    expect(twilio.ofType('media')[0]).toEqual({ event: 'media', streamSid: 'MZ1', media: { payload: 'CCCC' } });
    expect(twilio.ofType('mark')).toHaveLength(1);
    expect(hooks.log).toHaveBeenCalledWith('info', expect.objectContaining({ latencyMs: 640 }), 'voice turn latency');
  });

  it('barge-in: truncates what the caller did not hear and clears Twilio playback', async () => {
    const { bridge, twilio, openai, fromOpenAI, media, botSays } = setup();
    bridge.start('MZ1');
    await botSays('greet');

    media(10_000);
    fromOpenAI({ type: 'response.output_audio.delta', delta: 'DDDD', item_id: 'i3' });
    media(10_800);
    fromOpenAI({ type: 'input_audio_buffer.speech_started' });

    expect(openai.ofType('conversation.item.truncate')[0]).toEqual({
      type: 'conversation.item.truncate',
      item_id: 'i3',
      content_index: 0,
      audio_end_ms: 800,
    });
    expect(twilio.ofType('clear')).toHaveLength(1);
  });

  it('saves both sides of the transcript', () => {
    const { bridge, hooks, fromOpenAI } = setup();
    bridge.start('MZ1');
    fromOpenAI({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'my sink is leaking' });
    fromOpenAI({ type: 'response.output_audio_transcript.done', transcript: 'Sorry to hear that.' });
    expect(hooks.saveTranscript).toHaveBeenCalledWith('caller', 'my sink is leaking');
    expect(hooks.saveTranscript).toHaveBeenCalledWith('bot', 'Sorry to hear that.');
  });

  it('runs a tool through the shared dispatcher and asks the model to continue', async () => {
    const { bridge, openai, hooks, fromOpenAI } = setup(() => ({ content: { busy: [] } }));
    bridge.start('MZ1');
    openai.clear();

    fromOpenAI({ type: 'response.created' });
    fromOpenAI({
      type: 'response.function_call_arguments.done',
      name: 'check_availability',
      call_id: 'call_1',
      arguments: '{"window_start":"2026-11-09T08:00","window_end":"2026-11-09T17:00"}',
    });
    fromOpenAI({ type: 'response.done' });
    await flush();

    expect(hooks.dispatchTool).toHaveBeenCalledWith('check_availability', expect.stringContaining('window_start'));
    expect(openai.ofType('conversation.item.create')[0]).toEqual({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call_1', output: '{"busy":[]}' },
    });
    expect(openai.ofType('response.create')).toHaveLength(1);
  });

  it('escalation: marks the conversation, tells the caller someone will call back, hangs up after it plays', async () => {
    const { bridge, openai, hooks, fromOpenAI, botSays } = setup(() => ({
      content: { acknowledged: true },
      state: 'escalated',
      outboundMessage: 'passed to the team',
    }));
    bridge.start('MZ1');
    await botSays('greet');

    fromOpenAI({ type: 'response.created' });
    fromOpenAI({ type: 'response.function_call_arguments.done', name: 'escalate_to_human', call_id: 'c', arguments: '{"reason":"caller requested human"}' });
    fromOpenAI({ type: 'response.done' });
    await flush();

    expect(hooks.applyTerminal).toHaveBeenCalledWith(expect.objectContaining({ state: 'escalated' }));
    const out = openai.ofType('conversation.item.create').at(-1) as { item: { output: string } };
    expect(JSON.parse(out.item.output).voice_instruction).toMatch(/call them back/);
    expect(hooks.hangup).not.toHaveBeenCalled();

    await botSays('goodbye');
    expect(hooks.hangup).toHaveBeenCalledTimes(1);
  });

  it('spam: hangs up straight away', async () => {
    const { bridge, hooks, fromOpenAI } = setup(() => ({
      content: { ok: true },
      state: 'completed',
      outcome: 'spam',
      silentTerminate: true,
    }));
    bridge.start('MZ1');
    fromOpenAI({ type: 'response.function_call_arguments.done', name: 'mark_spam', call_id: 'c', arguments: '{"reason":"robocall"}' });
    fromOpenAI({ type: 'response.done' });
    await flush();
    expect(hooks.hangup).toHaveBeenCalledTimes(1);
  });

  it('texts a payment link instead of speaking it', async () => {
    const link = 'Hold your slot: https://pay.example/abc';
    const { bridge, openai, hooks, fromOpenAI } = setup(() => ({ content: { reserved: true }, outboundMessage: link, stopLoop: true }));
    bridge.start('MZ1');
    fromOpenAI({ type: 'response.function_call_arguments.done', name: 'book_appointment', call_id: 'c', arguments: '{}' });
    fromOpenAI({ type: 'response.done' });
    await flush();
    expect(hooks.sendSms).toHaveBeenCalledWith(link);
    const out = openai.ofType('conversation.item.create').at(-1) as { item: { output: string } };
    expect(JSON.parse(out.item.output).voice_instruction).toMatch(/check their messages/);
  });

  it('record_sms_consent and end_call are handled by the bridge', async () => {
    const { bridge, hooks, fromOpenAI, botSays } = setup();
    bridge.start('MZ1');
    await botSays('greet');

    fromOpenAI({ type: 'response.function_call_arguments.done', name: 'record_sms_consent', call_id: 'a', arguments: '{}' });
    fromOpenAI({ type: 'response.function_call_arguments.done', name: 'end_call', call_id: 'b', arguments: '{}' });
    fromOpenAI({ type: 'response.done' });
    await flush();
    expect(hooks.recordSmsConsent).toHaveBeenCalledTimes(1);
    expect(hooks.dispatchTool).not.toHaveBeenCalled();
    expect(hooks.hangup).not.toHaveBeenCalled();

    await botSays('bye');
    expect(hooks.hangup).toHaveBeenCalledTimes(1);
  });

  it('a late playback mark between a tool call and the next reply does not hang up early', async () => {
    const { bridge, hooks, fromOpenAI, fromTwilio, botSays } = setup();
    bridge.start('MZ1');
    await botSays('greet');

    fromOpenAI({ type: 'response.output_audio.delta', delta: 'EE', item_id: 'filler' });
    fromOpenAI({ type: 'response.function_call_arguments.done', name: 'end_call', call_id: 'b', arguments: '{}' });
    fromOpenAI({ type: 'response.done' });
    await flush();
    fromTwilio({ event: 'mark', mark: { name: 'r0' } }); // filler finished playing
    await flush();
    expect(hooks.hangup).not.toHaveBeenCalled();
  });

  it('falls back to the IVR if OpenAI drops mid-call, and reports the call', async () => {
    const { bridge, hooks } = setup();
    bridge.start('MZ1');
    bridge.onOpenAIClose();
    await flush();
    expect(hooks.fallbackToIvr).toHaveBeenCalledWith('openai_socket_closed');
    expect(hooks.onEnded).toHaveBeenCalledWith(expect.objectContaining({ endedBy: 'error' }));
  });

  it('time limit: escalates and wraps up', async () => {
    const { bridge, openai, hooks } = setup(() => ({ content: {}, state: 'escalated' }));
    bridge.start('MZ1');
    jest.advanceTimersByTime(600_000);
    await flush();
    expect(hooks.dispatchTool).toHaveBeenCalledWith('escalate_to_human', expect.stringContaining('time limit'));
    expect(openai.ofType('response.create')).toHaveLength(2);
  });

  it('Twilio stop ends the call once, with a summary', async () => {
    const { bridge, openai, hooks, fromTwilio } = setup();
    bridge.start('MZ1');
    fromTwilio({ event: 'stop' });
    bridge.onTwilioClose();
    await flush();
    expect(openai.readyState).toBe(3);
    expect(hooks.onEnded).toHaveBeenCalledTimes(1);
  });
});

describe('latencyStats', () => {
  it('summarises turn latencies', () => {
    expect(latencyStats([])).toBeNull();
    expect(latencyStats([900, 500, 700, 600, 800])).toEqual({ p50: 700, p90: 900, max: 900 });
  });
});
