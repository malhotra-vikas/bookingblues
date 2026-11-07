import { realtimeToolsFor } from './realtime-tools';
import { assembleVoiceInstructions, voiceGreeting } from './voice-prompt';
import { createVoiceToken, isVoiceAiEnabledFor, verifyVoiceToken } from './voice-session-token';

describe('voice session token', () => {
  const secret = 'twilio_auth_token';
  const now = 1_800_000_000_000;

  it('round-trips for the same call', () => {
    const token = createVoiceToken({ callSid: 'CA1', operatorId: 'op_1', secret, now });
    expect(verifyVoiceToken({ token, callSid: 'CA1', secret, now })).toBe('op_1');
  });

  it('rejects another call, a wrong secret, a tampered token, or an expired one', () => {
    const token = createVoiceToken({ callSid: 'CA1', operatorId: 'op_1', secret, now });
    expect(verifyVoiceToken({ token, callSid: 'CA2', secret, now })).toBeNull();
    expect(verifyVoiceToken({ token, callSid: 'CA1', secret: 'other', now })).toBeNull();
    expect(verifyVoiceToken({ token: `${token}x`, callSid: 'CA1', secret, now })).toBeNull();
    expect(verifyVoiceToken({ token, callSid: 'CA1', secret, now: now + 6 * 60_000 })).toBeNull();
    expect(verifyVoiceToken({ token: undefined, callSid: 'CA1', secret, now })).toBeNull();
  });
});

describe('isVoiceAiEnabledFor', () => {
  it('is off unless listed', () => {
    expect(isVoiceAiEnabledFor('op_1', undefined)).toBe(false);
    expect(isVoiceAiEnabledFor('op_1', 'op_2')).toBe(false);
    expect(isVoiceAiEnabledFor('op_1', 'op_2, op_1')).toBe(true);
    expect(isVoiceAiEnabledFor('op_1', '*')).toBe(true);
  });
});

describe('voice prompt', () => {
  it('greeting carries both disclosures', () => {
    const g = voiceGreeting('Zeus Plumbing');
    expect(g).toContain('Zeus Plumbing');
    expect(g).toContain('AI assistant');
    expect(g).toContain('call is recorded');
  });

  it('appends voice rules after the SMS prompt, with optional texts and calendar', () => {
    const out = assembleVoiceInstructions({
      baseSystemPrompt: 'BASE',
      recentTexts: 'Caller: hi',
      preloadedAvailability: '{"busy":[]}',
    });
    expect(out.indexOf('BASE')).toBeLessThan(out.indexOf('EARLIER TEXT MESSAGES'));
    expect(out.indexOf('CALENDAR SNAPSHOT')).toBeLessThan(out.indexOf('VOICE CALL MODE'));
    expect(assembleVoiceInstructions({ baseSystemPrompt: 'BASE' })).not.toContain('EARLIER TEXT');
  });
});

describe('realtimeToolsFor', () => {
  it('flattens the SMS tools, drops propose_slots, adds the voice-only tools', () => {
    const tools = realtimeToolsFor('plumbing');
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['check_availability', 'book_appointment', 'escalate_to_human']));
    expect(names).toContain('record_sms_consent');
    expect(names).toContain('end_call');
    expect(names).not.toContain('propose_slots');
    expect(tools.every((t) => t.type === 'function' && !('function' in t))).toBe(true);
  });

  it('insurance gets its own tool list (no field-visit tools)', () => {
    const names = realtimeToolsFor('insurance').map((t) => t.name);
    expect(names).not.toContain('collect_service_address');
    expect(names).toContain('save_intake_answers');
  });
});
