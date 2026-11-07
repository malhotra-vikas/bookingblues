import type { Request } from 'express';
import type { PinoLogger } from 'nestjs-pino';

import type { SupabaseService } from '../../common/supabase/supabase.service';
import type { TwilioService } from '../../common/twilio/twilio.service';
import type { WebhookIdempotencyService } from '../../common/webhooks/webhook-idempotency.service';
import type { Env } from '../../config/env';
import type { AdvanceService } from '../ai/advance.service';
import { AdvanceSchedulerService } from '../ai/advance-scheduler.service';
import type { ConversationsService } from '../conversations/conversations.service';
import type { EmergencyClassifierService } from '../conversations/emergency-classifier.service';
import type { EscalationsService } from '../slack/escalations.service';

import type { ConversationOpeningService } from './conversation-opening.service';
import { TwilioSmsController } from './twilio-sms.controller';

/**
 * Text-first contact: a caller texts the operator's number instead of calling.
 * The SMS webhook must start the conversation the way a missed call does
 * (consent + opening SMS) instead of handing the first text to the AI.
 */

const OPERATOR = {
  id: 'op_1',
  business_name: 'Zeus Plumbing',
  category: 'plumbing',
  twilio_number_e164: '+15555550100',
  personal_phone_e164: null,
};
const CONVO = { id: 'c1', slack_thread_ts: null };
const CALLER = '+15555550200';

function makeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

function makeSupabase(): SupabaseService {
  const rowFor = (table: string) => (table === 'operators' ? OPERATOR : CONVO);
  const from = jest.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: rowFor(table), error: null }),
        single: async () => ({ data: rowFor(table), error: null }),
      }),
    }),
  }));
  return { db: () => ({ from }) } as unknown as SupabaseService;
}

function build(opts: { hasBotMessage?: boolean; openEscalation?: boolean } = {}) {
  const logger = makeLogger();
  const scheduler = new AdvanceSchedulerService(logger);
  const advance = { advance: jest.fn().mockResolvedValue(undefined) };
  let botMessageExists = opts.hasBotMessage ?? false;
  const opening = {
    hasBotMessage: jest.fn(async () => botMessageExists),
    recordConsent: jest.fn().mockResolvedValue(undefined),
    sendOpening: jest.fn(async () => {
      botMessageExists = true;
    }),
  };
  let sid = 0;
  const controller = new TwilioSmsController(
    makeSupabase(),
    { validateSignature: () => true } as unknown as TwilioService,
    {
      getOrCreate: jest.fn().mockResolvedValue(CONVO),
      appendMessage: jest.fn().mockResolvedValue(undefined),
    } as unknown as ConversationsService,
    { classify: jest.fn().mockResolvedValue(null) } as unknown as EmergencyClassifierService,
    advance as unknown as AdvanceService,
    scheduler,
    {
      ensureConversationThread: jest.fn().mockResolvedValue({}),
      echoCallerMessageToConversationThread: jest.fn().mockResolvedValue(undefined),
      findOpenForConversation: jest.fn().mockResolvedValue(opts.openEscalation ? { id: 'e1' } : null),
    } as unknown as EscalationsService,
    {
      record: jest.fn(async () => ({ status: 'new', id: `evt_${++sid}` })),
      markProcessed: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    } as unknown as WebhookIdempotencyService,
    opening as unknown as ConversationOpeningService,
    logger,
    { API_URL: 'http://localhost:3001' } as Env,
  );
  const req = { originalUrl: '/webhooks/twilio/sms/op_1', header: () => 'sig' } as unknown as Request;
  const text = (body: string) =>
    controller.handle(req, 'op_1', {
      MessageSid: `SM_in_${++sid}`,
      From: CALLER,
      To: OPERATOR.twilio_number_e164,
      Body: body,
    });
  return { text, opening, advance };
}

describe('TwilioSmsController text-first contact', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const flush = async () => {
    await jest.runAllTimersAsync();
  };

  it('a first text records consent and sends the opening, and does not run the AI', async () => {
    const { text, opening, advance } = build();
    await text('hi');
    await flush();

    expect(opening.recordConsent).toHaveBeenCalledWith({
      operatorId: 'op_1',
      callerPhoneE164: CALLER,
      channel: 'text',
    });
    expect(opening.sendOpening).toHaveBeenCalledTimes(1);
    expect(opening.sendOpening).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1', callerPhoneE164: CALLER, channel: 'text' }),
    );
    expect(advance.advance).not.toHaveBeenCalled();
  });

  it('the reply after the opening goes to the AI', async () => {
    const { text, opening, advance } = build();
    await text('hi');
    await flush();
    await text('my water heater is leaking');
    await flush();

    expect(opening.sendOpening).toHaveBeenCalledTimes(1);
    expect(advance.advance).toHaveBeenCalledTimes(1);
  });

  it('a burst of first texts sends one opening', async () => {
    const { text, opening } = build();
    await text('hi');
    await text('need a plumber');
    await text('08820');
    await flush();

    expect(opening.sendOpening).toHaveBeenCalledTimes(1);
    expect(opening.recordConsent).toHaveBeenCalledTimes(1);
  });

  it('a first text of STOP sends nothing and cancels a pending opening', async () => {
    const { text, opening, advance } = build();
    await text('hi');
    await text('STOP');
    await flush();

    expect(opening.sendOpening).not.toHaveBeenCalled();
    expect(opening.recordConsent).not.toHaveBeenCalled();
    expect(advance.advance).not.toHaveBeenCalled();
  });

  it('texting after a call (opening already sent) goes straight to the AI', async () => {
    const { text, opening, advance } = build({ hasBotMessage: true });
    await text('hi, I just called');
    await flush();

    expect(opening.sendOpening).not.toHaveBeenCalled();
    expect(advance.advance).toHaveBeenCalledTimes(1);
  });

  it('a conversation a human owns gets no opening', async () => {
    const { text, opening, advance } = build({ openEscalation: true });
    await text('hello?');
    await flush();

    expect(opening.sendOpening).not.toHaveBeenCalled();
    expect(advance.advance).not.toHaveBeenCalled();
  });
});
