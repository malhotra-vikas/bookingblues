import crypto from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@bookingblues/db-types';
import request from 'supertest';

import { buildTestApp } from './helpers/app';
import {
  describeIfSupabase,
  readTestEnv,
  setupTenants,
  teardownTenants,
  type TestTenant,
} from './helpers/tenants';

// Twilio creds: must be set BEFORE the Nest app boots so TwilioService picks them up.
const TEST_AUTH_TOKEN = 'test_twilio_auth_token_for_signature_only';
process.env.TWILIO_ACCOUNT_SID ||= 'ACtest_dummy_for_sdk_init';
process.env.TWILIO_AUTH_TOKEN = TEST_AUTH_TOKEN;
process.env.API_URL = 'http://localhost:3001';

/**
 * End-to-end cover for the voice IVR opt-in gate, using Twilio's real signature
 * math (CLAUDE.md §13) against the actual HTTP surface.
 *
 * Regression context (2026-07-16): the gate silently declined ~every real
 * caller. Twilio logs showed `digits: ""` on every inbound call — the ask sat
 * ~18s in, behind the disclosure, so callers hung up before hearing it, and a
 * single empty <Gather> ended the call outright. These tests drive the exact
 * caller behaviours that were failing in production:
 *   - stays silent once  -> must be re-asked, NOT declined
 *   - stays silent twice -> declined (default-deny still holds)
 *   - presses 1 late     -> texted
 * Outbound SMS is blocked by the non-prod allowlist (§11.12), so the caller
 * number below must stay OUTSIDE OUTBOUND_SMS_ALLOWLIST.
 */

function signTwilioRequest(url: string, params: Record<string, string>): string {
  const sortedKeys = Object.keys(params).sort();
  const data = url + sortedKeys.map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', TEST_AUTH_TOKEN).update(data).digest('base64');
}

describeIfSupabase('Twilio voice IVR consent gate', () => {
  let app: INestApplication;
  let tenants: readonly TestTenant[];
  let serviceClient: SupabaseClient<Database>;
  const operatorNumber = '+15555550300';
  // Deliberately not in OUTBOUND_SMS_ALLOWLIST -> sendSms returns {skipped}.
  const callerNumber = '+15555550400';
  let operatorId: string;

  // CallSids must be unique per run. `webhook_events` is the idempotency ledger
  // and carries no operator_id, so tenant teardown doesn't cascade it — a fixed
  // CallSid would be seen as a duplicate replay on the second run and the
  // side effects would (correctly) be skipped, failing the test for the wrong
  // reason. This suite shares a DB with prod (.env.local), so rows outlive runs.
  const runId = crypto.randomUUID().slice(0, 8);
  const callSid = (name: string): string => `CA_ivr_${name}_${runId}`;

  const voicePath = (): string => `/webhooks/twilio/voice/${operatorId}`;
  const consentPath = (attempt: string): string =>
    `/webhooks/twilio/voice/${operatorId}/consent?attempt=${attempt}`;

  /** POST a form to `path` signed exactly as Twilio would (query string included). */
  async function postSigned(
    path: string,
    params: Record<string, string>,
  ): Promise<request.Response> {
    const sig = signTwilioRequest(`${process.env.API_URL}${path}`, params);
    return request(app.getHttpServer())
      .post(path)
      .type('form')
      .set('x-twilio-signature', sig)
      .send(params);
  }

  const gatherForm = (opts: {
    callSid: string;
    digits?: string;
    speech?: string;
  }): Record<string, string> => ({
    CallSid: opts.callSid,
    AccountSid: 'ACtest_dummy_for_sdk_init',
    From: callerNumber,
    To: operatorNumber,
    Digits: opts.digits ?? '',
    ...(opts.speech === undefined ? {} : { SpeechResult: opts.speech }),
  });

  beforeAll(async () => {
    app = await buildTestApp();
    tenants = await setupTenants(1);
    const env = readTestEnv()!;
    serviceClient = createClient<Database>(env.url, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    operatorId = tenants[0]!.operatorId;
    const { error } = await serviceClient
      .from('operators')
      .update({
        twilio_number_e164: operatorNumber,
        twilio_number_sid: `PN_test_${operatorId.slice(0, 8)}`,
      })
      .eq('id', operatorId);
    if (error) throw error;
  });

  afterAll(async () => {
    // Neither table carries operator_id, so tenant teardown won't cascade them.
    // We share a DB with prod — leave nothing behind.
    if (serviceClient) {
      await serviceClient.from('sms_consents').delete().eq('phone_e164', callerNumber);
      await serviceClient.from('webhook_events').delete().like('event_id', `%_${runId}`);
    }
    if (app) await app.close();
    if (tenants) await teardownTenants(tenants);
  });

  describe('the opening prompt', () => {
    it('asks for the opt-in before the disclosure, so callers hear the ask', async () => {
      const res = await postSigned(voicePath(), {
        CallSid: callSid('open_1'),
        AccountSid: 'ACtest_dummy_for_sdk_init',
        From: callerNumber,
        To: operatorNumber,
      });
      expect(res.status).toBe(200);
      const ask = res.text.toLowerCase().indexOf('press 1');
      const rates = res.text.toLowerCase().indexOf('message and data rates');
      expect(ask).toBeGreaterThanOrEqual(0);
      expect(rates).toBeGreaterThanOrEqual(0);
      expect(ask).toBeLessThan(rates); // the bug: ask used to come last
    });

    it('gives the caller a 10s window and routes to attempt 1', async () => {
      const res = await postSigned(voicePath(), {
        CallSid: callSid('open_2'),
        AccountSid: 'ACtest_dummy_for_sdk_init',
        From: callerNumber,
        To: operatorNumber,
      });
      expect(res.text).toContain('timeout="10"');
      expect(res.text).toContain('consent?attempt=1');
    });
  });

  describe('a caller who says nothing', () => {
    it('is re-asked rather than declined on the first silence', async () => {
      const res = await postSigned(
        consentPath('1'),
        gatherForm({ callSid: callSid('silent_1') }),
      );
      expect(res.status).toBe(200);
      expect(res.text.toLowerCase()).toContain('still there');
      expect(res.text.toLowerCase()).not.toContain('we will not text you');
      expect(res.text).toContain('consent?attempt=2');
    });

    it('is declined after the second silence — default-deny still holds', async () => {
      const res = await postSigned(
        consentPath('2'),
        gatherForm({ callSid: callSid('silent_2') }),
      );
      expect(res.status).toBe(200);
      expect(res.text.toLowerCase()).toContain('we will not text you');

      const { data } = await serviceClient
        .from('sms_consents')
        .select('id')
        .eq('phone_e164', callerNumber);
      expect(data?.length ?? 0).toBe(0); // never texted, never consented
    });
  });

  describe('a caller who opts in on the second ask', () => {
    it('is texted, and the verbal consent is recorded as proof', async () => {
      const res = await postSigned(
        consentPath('2'),
        gatherForm({ callSid: callSid('optin_late'), digits: '1' }),
      );
      expect(res.status).toBe(200);
      expect(res.text.toLowerCase()).toContain('we will text you');

      const { data: consents } = await serviceClient
        .from('sms_consents')
        .select('source, consent_version, consent_text')
        .eq('phone_e164', callerNumber);
      expect(consents?.length).toBe(1);
      expect(consents![0]!.source).toBe('voice_ivr');
      expect(consents![0]!.consent_version).toBe('voice-ivr-2026-07-16');
      // What we say == what we store == what we submit to the carrier.
      expect(consents![0]!.consent_text.toLowerCase()).toContain('stop to opt out');

      const { data: convos } = await serviceClient
        .from('conversations')
        .select('id')
        .eq('operator_id', operatorId)
        .eq('caller_phone_e164', callerNumber);
      expect(convos?.length).toBe(1);
    });
  });

  describe('request signing', () => {
    it('rejects an unsigned request', async () => {
      const res = await request(app.getHttpServer())
        .post(consentPath('1'))
        .type('form')
        .send(gatherForm({ callSid: callSid('nosig') }));
      expect(res.status).toBe(400);
    });

    it('rejects a signature computed without the ?attempt query string', async () => {
      // The attempt param is part of the signed URL. If verifyTwilioSignature
      // ever stops using req.originalUrl, this passes a stale signature and the
      // whole consent gate 400s in production — louder to catch here.
      const params = gatherForm({ callSid: callSid('stripped_sig') });
      const strippedUrl = `${process.env.API_URL}/webhooks/twilio/voice/${operatorId}/consent`;
      const badSig = signTwilioRequest(strippedUrl, params);
      const res = await request(app.getHttpServer())
        .post(consentPath('1'))
        .type('form')
        .set('x-twilio-signature', badSig)
        .send(params);
      expect(res.status).toBe(400);
    });
  });
});
