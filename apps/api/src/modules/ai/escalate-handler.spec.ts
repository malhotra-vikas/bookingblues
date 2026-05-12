import type { PinoLogger } from 'nestjs-pino';

import { escalateToHuman } from './tool-handlers';
import type { ToolContext } from './tool-handlers';

function makeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as PinoLogger;
}

function makeCtx(open: jest.Mock): ToolContext {
  return {
    operator: {
      id: 'op_1',
      business_name: 'Acme',
      twilio_number_e164: '+15555550001',
    } as unknown as ToolContext['operator'],
    conversation: { id: 'conv_1' } as unknown as ToolContext['conversation'],
    callerPhoneE164: '+15555550002',
    supabase: {} as never,
    calendar: {} as never,
    twilio: {} as never,
    conversations: {} as never,
    payments: {} as never,
    escalations: { openEscalation: open } as unknown as ToolContext['escalations'],
    bookings: {} as never,
    logger: makeLogger(),
  };
}

describe('escalate_to_human', () => {
  it('flips state to escalated and opens an escalation, even if Slack call fails', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: { id: 'esc_1' }, deliveredVia: 'slack' });
    const ctx = makeCtx(open);
    const result = await escalateToHuman({ reason: 'caller asked for a human' }, ctx);
    expect(result.state).toBe('escalated');
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        operator: ctx.operator,
        conversation: ctx.conversation,
        callerPhoneE164: '+15555550002',
        reason: 'caller_requested',
        openedBy: 'caller',
      }),
    );
  });

  it('still returns the escalated state when the bridge service throws', async () => {
    const open = jest.fn().mockRejectedValue(new Error('Slack down'));
    const ctx = makeCtx(open);
    const result = await escalateToHuman({ reason: 'bot got stuck' }, ctx);
    expect(result.state).toBe('escalated');
    expect(open).toHaveBeenCalled();
  });

  it('maps "turn cap" reason to turn_cap enum', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: {}, deliveredVia: 'slack' });
    const ctx = makeCtx(open);
    await escalateToHuman({ reason: 'turn_cap: hit cap' }, ctx);
    expect(open.mock.calls[0]?.[0].reason).toBe('turn_cap');
  });

  it('maps "calendar revoked" reason to calendar_revoked', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: {}, deliveredVia: 'slack' });
    const ctx = makeCtx(open);
    await escalateToHuman({ reason: 'calendar revoked' }, ctx);
    expect(open.mock.calls[0]?.[0].reason).toBe('calendar_revoked');
  });

  it('defaults unknown reasons to bot_stuck', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: {}, deliveredVia: 'slack' });
    const ctx = makeCtx(open);
    await escalateToHuman({ reason: 'something unspecified' }, ctx);
    expect(open.mock.calls[0]?.[0].reason).toBe('bot_stuck');
    expect(open.mock.calls[0]?.[0].openedBy).toBe('bot');
  });
});
