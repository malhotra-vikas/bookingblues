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

function signTwilioRequest(
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  const data = url + sortedKeys.map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', TEST_AUTH_TOKEN).update(data).digest('base64');
}

function smsForm(opts: {
  messageSid: string;
  from: string;
  to: string;
  body: string;
}): Record<string, string> {
  return {
    MessageSid: opts.messageSid,
    AccountSid: 'ACtest_dummy_for_sdk_init',
    From: opts.from,
    To: opts.to,
    Body: opts.body,
  };
}

describeIfSupabase('Twilio SMS webhook', () => {
  let app: INestApplication;
  let tenants: readonly TestTenant[];
  let serviceClient: SupabaseClient<Database>;
  const operatorNumber = '+15555550100';
  const callerNumber = '+15555550200';

  beforeAll(async () => {
    app = await buildTestApp();
    tenants = await setupTenants(1);
    const env = readTestEnv()!;
    serviceClient = createClient<Database>(env.url, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const a = tenants[0]!;
    const { error } = await serviceClient
      .from('operators')
      .update({
        twilio_number_e164: operatorNumber,
        twilio_number_sid: `PN_test_${a.operatorId.slice(0, 8)}`,
      })
      .eq('id', a.operatorId);
    if (error) throw error;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenants) await teardownTenants(tenants);
  });

  it('rejects requests without a signature with 400', async () => {
    const a = tenants[0]!;
    const params = smsForm({
      messageSid: 'SM_no_sig',
      from: callerNumber,
      to: operatorNumber,
      body: 'hi',
    });
    const res = await request(app.getHttpServer())
      .post(`/webhooks/twilio/sms/${a.operatorId}`)
      .type('form')
      .send(params);
    expect(res.status).toBe(400);
  });

  it('rejects requests with a tampered signature with 400', async () => {
    const a = tenants[0]!;
    const params = smsForm({
      messageSid: 'SM_bad_sig',
      from: callerNumber,
      to: operatorNumber,
      body: 'hi',
    });
    const res = await request(app.getHttpServer())
      .post(`/webhooks/twilio/sms/${a.operatorId}`)
      .type('form')
      .set('x-twilio-signature', 'definitely-not-valid')
      .send(params);
    expect(res.status).toBe(400);
  });

  it('rejects when To does not match the operator number with 403 (§11.10)', async () => {
    const a = tenants[0]!;
    const params = smsForm({
      messageSid: 'SM_wrong_to',
      from: callerNumber,
      to: '+15555559999',
      body: 'hi',
    });
    const url = `${process.env.API_URL}/webhooks/twilio/sms/${a.operatorId}`;
    const sig = signTwilioRequest(url, params);
    const res = await request(app.getHttpServer())
      .post(`/webhooks/twilio/sms/${a.operatorId}`)
      .type('form')
      .set('x-twilio-signature', sig)
      .send(params);
    expect(res.status).toBe(403);
  });

  it('persists the inbound message and creates a conversation', async () => {
    const a = tenants[0]!;
    const params = smsForm({
      messageSid: `SM_ok_${Date.now()}`,
      from: callerNumber,
      to: operatorNumber,
      body: 'I have a leaking pipe',
    });
    const url = `${process.env.API_URL}/webhooks/twilio/sms/${a.operatorId}`;
    const sig = signTwilioRequest(url, params);
    const res = await request(app.getHttpServer())
      .post(`/webhooks/twilio/sms/${a.operatorId}`)
      .type('form')
      .set('x-twilio-signature', sig)
      .send(params);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<Response/>');

    const { data: convos } = await serviceClient
      .from('conversations')
      .select('id, caller_phone_e164, status')
      .eq('operator_id', a.operatorId)
      .eq('caller_phone_e164', callerNumber);
    expect(convos?.length).toBeGreaterThan(0);

    const { data: msgs } = await serviceClient
      .from('messages')
      .select('role, body, twilio_message_sid')
      .eq('twilio_message_sid', params.MessageSid!);
    expect(msgs?.length).toBe(1);
    expect(msgs![0]!.role).toBe('caller');
    expect(msgs![0]!.body).toBe('I have a leaking pipe');
  });

  it('is idempotent — replaying the same MessageSid does not double-write', async () => {
    const a = tenants[0]!;
    const sid = `SM_idem_${Date.now()}`;
    const params = smsForm({
      messageSid: sid,
      from: callerNumber,
      to: operatorNumber,
      body: 'first',
    });
    const url = `${process.env.API_URL}/webhooks/twilio/sms/${a.operatorId}`;
    const sig1 = signTwilioRequest(url, params);
    await request(app.getHttpServer())
      .post(`/webhooks/twilio/sms/${a.operatorId}`)
      .type('form')
      .set('x-twilio-signature', sig1)
      .send(params);

    // Replay with same MessageSid but a different body — should be a no-op.
    const params2 = { ...params, Body: 'second' };
    const sig2 = signTwilioRequest(url, params2);
    const res = await request(app.getHttpServer())
      .post(`/webhooks/twilio/sms/${a.operatorId}`)
      .type('form')
      .set('x-twilio-signature', sig2)
      .send(params2);
    expect(res.status).toBe(200);

    const { data: msgs } = await serviceClient
      .from('messages')
      .select('body')
      .eq('twilio_message_sid', sid);
    expect(msgs?.length).toBe(1);
    expect(msgs![0]!.body).toBe('first');
  });
});
