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

function makeCtx(open: jest.Mock, notify: jest.Mock = jest.fn().mockResolvedValue(undefined)): ToolContext {
  return {
    handoffNotifier: { notify } as unknown as ToolContext['handoffNotifier'],
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
    intakeAnswers: {} as never,
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

  it('emails the operator + admins when it opens a new escalation', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: {}, deliveredVia: 'slack', created: true });
    const notify = jest.fn().mockResolvedValue(undefined);
    const ctx = makeCtx(open, notify);
    await escalateToHuman({ reason: 'caller wants to talk about a claim' }, ctx);
    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0]?.[0];
    expect(arg.conversationId).toBe('conv_1');
    expect(arg.callerPhoneE164).toBe('+15555550002');
    expect(arg.content.operator.why).toContain('caller wants to talk about a claim');
  });

  it('does not email again when an escalation was already open', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: {}, deliveredVia: 'slack', created: false });
    const notify = jest.fn();
    await escalateToHuman({ reason: 'again' }, makeCtx(open, notify));
    expect(notify).not.toHaveBeenCalled();
  });

  it('still emails when Slack fails (the email is then the only alert)', async () => {
    const open = jest.fn().mockRejectedValue(new Error('Slack down'));
    const notify = jest.fn().mockResolvedValue(undefined);
    await escalateToHuman({ reason: 'bot got stuck' }, makeCtx(open, notify));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('turn cap gets a plain explanation, not the raw code', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: {}, deliveredVia: 'slack', created: true });
    const notify = jest.fn().mockResolvedValue(undefined);
    await escalateToHuman({ reason: 'turn_cap: caller turn cap (20) reached' }, makeCtx(open, notify));
    expect(notify.mock.calls[0]?.[0].content.operator.why).toBe(
      'The conversation reached the message limit without a booking, so the assistant stopped and handed it to a person.',
    );
  });

  it('defaults unknown reasons to bot_stuck', async () => {
    const open = jest.fn().mockResolvedValue({ escalation: {}, deliveredVia: 'slack' });
    const ctx = makeCtx(open);
    await escalateToHuman({ reason: 'something unspecified' }, ctx);
    expect(open.mock.calls[0]?.[0].reason).toBe('bot_stuck');
    expect(open.mock.calls[0]?.[0].openedBy).toBe('bot');
  });
});
