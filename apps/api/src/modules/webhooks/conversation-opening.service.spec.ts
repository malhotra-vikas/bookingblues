import type { PinoLogger } from 'nestjs-pino';

import type { SupabaseService } from '../../common/supabase/supabase.service';
import type { TwilioService } from '../../common/twilio/twilio.service';
import { SMS_INBOUND_CONSENT_VERSION, VOICE_CONSENT_VERSION } from '../consent/sms-consent.dto';
import type { ConversationsService } from '../conversations/conversations.service';
import {
  openingSms,
  textOpeningSms,
  usageLimitOpeningSms,
} from '../conversations/templates/sms-templates';
import type { UsageService } from '../usage/usage.service';

import { ConversationOpeningService, isCarrierKeyword } from './conversation-opening.service';

const operator = {
  id: 'op_1',
  business_name: 'Zeus Plumbing',
  category: 'plumbing',
  twilio_number_e164: '+15555550100',
};
const caller = '+15555550200';

function makeLogger(): PinoLogger {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as PinoLogger;
}

function build(opts: { admitted?: boolean; send?: { sid: string } | { skipped: string }; botCount?: number } = {}) {
  const insert = jest.fn().mockResolvedValue({ error: null });
  const countEq2 = jest.fn().mockResolvedValue({ count: opts.botCount ?? 0, error: null });
  const countEq1 = jest.fn().mockReturnValue({ eq: countEq2 });
  const select = jest.fn().mockReturnValue({ eq: countEq1 });
  const from = jest.fn().mockReturnValue({ insert, select });
  const supabase = { db: () => ({ from }) } as unknown as SupabaseService;
  const sendSms = jest.fn().mockResolvedValue(opts.send ?? { sid: 'SM_out_1' });
  const twilio = { sendSms } as unknown as TwilioService;
  const appendMessage = jest.fn().mockResolvedValue(undefined);
  const conversations = { appendMessage } as unknown as ConversationsService;
  const wouldAdmit = jest.fn().mockResolvedValue(opts.admitted ?? true);
  const usage = { wouldAdmit } as unknown as UsageService;
  const svc = new ConversationOpeningService(supabase, twilio, conversations, usage, makeLogger());
  return { svc, from, insert, sendSms, appendMessage, countEq2 };
}

describe('isCarrierKeyword', () => {
  it.each(['STOP', 'stop', ' Stop. ', 'UNSUBSCRIBE', 'HELP', 'start', 'Quit!'])('%p is a carrier keyword', (b) => {
    expect(isCarrierKeyword(b)).toBe(true);
  });
  it.each(['hi', 'yes', 'YES', 'stop by tomorrow?', 'help with a leak'])('%p is not', (b) => {
    expect(isCarrierKeyword(b)).toBe(false);
  });
});

describe('ConversationOpeningService', () => {
  it('text channel sends the "thanks for texting" opening with the STOP disclosure', async () => {
    const { svc, sendSms, appendMessage } = build();
    await svc.sendOpening({ operator, conversationId: 'c1', callerPhoneE164: caller, channel: 'text' });

    const body = textOpeningSms('Zeus Plumbing', 'plumbing');
    expect(body).toContain('Thanks for texting Zeus Plumbing');
    expect(body).toContain('Reply STOP to opt out. Msg & data rates may apply.');
    expect(sendSms).toHaveBeenCalledWith({ from: '+15555550100', to: caller, body });
    expect(appendMessage).toHaveBeenCalledWith({
      conversationId: 'c1',
      role: 'bot',
      body,
      twilioMessageSid: 'SM_out_1',
    });
  });

  it('call channel keeps the original "thanks for calling" opening', async () => {
    const { svc, sendSms } = build();
    await svc.sendOpening({ operator, conversationId: 'c1', callerPhoneE164: caller, channel: 'call' });
    expect(sendSms.mock.calls[0][0].body).toBe(openingSms('Zeus Plumbing', 'plumbing'));
  });

  it('a new caller over the plan limit gets the limit opening on either channel', async () => {
    for (const channel of ['text', 'call'] as const) {
      const { svc, sendSms } = build({ admitted: false });
      await svc.sendOpening({ operator, conversationId: 'c1', callerPhoneE164: caller, channel });
      expect(sendSms.mock.calls[0][0].body).toBe(usageLimitOpeningSms('Zeus Plumbing'));
    }
  });

  it('records a skipped send so the next text is not treated as first contact', async () => {
    const { svc, appendMessage } = build({ send: { skipped: 'allowlist' } });
    await svc.sendOpening({ operator, conversationId: 'c1', callerPhoneE164: caller, channel: 'text' });
    expect(appendMessage).toHaveBeenCalledWith({
      conversationId: 'c1',
      role: 'bot',
      body: `[skipped: allowlist] ${textOpeningSms('Zeus Plumbing', 'plumbing')}`,
    });
  });

  it('insurance gets its own text-first wording', () => {
    const body = textOpeningSms('Insurance Test', 'insurance');
    expect(body).toContain('thanks for your text');
    expect(body).toContain('one of our agents');
    expect(body).toContain('Reply STOP to opt out');
  });

  it('records sms_inbound consent for a text and voice_ivr consent for a call', async () => {
    const { svc, insert } = build();
    await svc.recordConsent({ operatorId: 'op_1', callerPhoneE164: caller, channel: 'text' });
    await svc.recordConsent({
      operatorId: 'op_1',
      callerPhoneE164: caller,
      channel: 'call',
      affirmation: 'pressed 1',
    });
    expect(insert.mock.calls[0][0]).toMatchObject({
      phone_e164: caller,
      source: 'sms_inbound',
      consent_version: SMS_INBOUND_CONSENT_VERSION,
      name: null,
    });
    expect(insert.mock.calls[1][0]).toMatchObject({
      phone_e164: caller,
      source: 'voice_ivr',
      consent_version: VOICE_CONSENT_VERSION,
      user_agent: 'twilio-voice-ivr (pressed 1)',
    });
  });

  it('hasBotMessage counts bot messages over the whole conversation', async () => {
    expect(await build({ botCount: 0 }).svc.hasBotMessage('c1')).toBe(false);
    const withBot = build({ botCount: 2 });
    expect(await withBot.svc.hasBotMessage('c1')).toBe(true);
    expect(withBot.countEq2).toHaveBeenCalledWith('role', 'bot');
  });
});
