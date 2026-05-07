import type { INestApplication } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@bookingblues/db-types';
import Stripe from 'stripe';
import request from 'supertest';

import { buildTestApp } from './helpers/app';
import {
  describeIfSupabase,
  readTestEnv,
  setupTenants,
  teardownTenants,
  type TestTenant,
} from './helpers/tenants';

// We provision Stripe creds before the Nest app boots so env validation +
// StripeService pick them up. STRIPE_SECRET_KEY only needs to be a
// well-formed test key (the SDK never makes a real API call in this suite).
const TEST_WEBHOOK_SECRET = 'whsec_test_secret_for_signature_only';
process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy_for_sdk_init';
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.STRIPE_PRICE_STARTER ||= 'price_test_starter';

function signedRequest(
  app: INestApplication,
  payload: object,
): request.Test {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: TEST_WEBHOOK_SECRET,
  });
  return request(app.getHttpServer())
    .post('/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('stripe-signature', header)
    .send(body);
}

function subscriptionCreatedEvent(opts: {
  eventId: string;
  customerId: string;
  subscriptionId: string;
  status: Stripe.Subscription.Status;
  trialEndUnix: number | null;
}): object {
  return {
    id: opts.eventId,
    object: 'event',
    api_version: '2024-10-28.acacia',
    type: 'customer.subscription.created',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: opts.subscriptionId,
        object: 'subscription',
        customer: opts.customerId,
        status: opts.status,
        trial_end: opts.trialEndUnix,
        items: { object: 'list', data: [] },
      },
    },
  };
}

describeIfSupabase('Stripe platform webhook', () => {
  let app: INestApplication;
  let tenants: readonly TestTenant[];
  let serviceClient: SupabaseClient<Database>;

  beforeAll(async () => {
    app = await buildTestApp();
    tenants = await setupTenants(2);
    const env = readTestEnv()!;
    serviceClient = createClient<Database>(env.url, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Pin a known stripe_customer_id on tenant A so the handlers can resolve it.
    const a = tenants[0]!;
    const { error } = await serviceClient
      .from('operators')
      .update({ stripe_customer_id: `cus_test_${a.operatorId.slice(0, 8)}` })
      .eq('id', a.operatorId);
    if (error) throw error;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (tenants) await teardownTenants(tenants);
  });

  it('rejects unsigned requests with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .send({ id: 'evt_unsigned', type: 'noop' });
    expect(res.status).toBe(400);
  });

  it('rejects bad signatures with 400', async () => {
    const body = JSON.stringify({ id: 'evt_bad_sig', type: 'noop' });
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send(body);
    expect(res.status).toBe(400);
  });

  it('applies customer.subscription.created → operator subscription_status', async () => {
    const a = tenants[0]!;
    const customerId = `cus_test_${a.operatorId.slice(0, 8)}`;
    const trialEndUnix = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    const eventId = `evt_sub_created_${Date.now()}`;
    const res = await signedRequest(
      app,
      subscriptionCreatedEvent({
        eventId,
        customerId,
        subscriptionId: 'sub_test_AAA',
        status: 'trialing',
        trialEndUnix,
      }),
    );
    expect(res.status).toBe(200);

    const { data: opA } = await serviceClient
      .from('operators')
      .select('subscription_status, stripe_subscription_id, trial_ends_at')
      .eq('id', a.operatorId)
      .single();
    expect(opA?.subscription_status).toBe('trialing');
    expect(opA?.stripe_subscription_id).toBe('sub_test_AAA');
    expect(opA?.trial_ends_at).not.toBeNull();
  });

  it('is idempotent — re-delivery of the same event id is a no-op', async () => {
    const a = tenants[0]!;
    const customerId = `cus_test_${a.operatorId.slice(0, 8)}`;
    const eventId = `evt_idempotent_${Date.now()}`;
    const trialEnd = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

    // First delivery: writes 'trialing' with sub_test_DUP1.
    await signedRequest(
      app,
      subscriptionCreatedEvent({
        eventId,
        customerId,
        subscriptionId: 'sub_test_DUP1',
        status: 'trialing',
        trialEndUnix: trialEnd,
      }),
    );

    // Second delivery: same event id, but with a different subscription id
    // payload to detect whether the handler ran a second time.
    const res = await signedRequest(
      app,
      subscriptionCreatedEvent({
        eventId,
        customerId,
        subscriptionId: 'sub_test_DUP2',
        status: 'active',
        trialEndUnix: trialEnd,
      }),
    );
    expect(res.status).toBe(200);

    const { data: opA } = await serviceClient
      .from('operators')
      .select('stripe_subscription_id, subscription_status')
      .eq('id', a.operatorId)
      .single();
    // The first delivery's values must be preserved.
    expect(opA?.stripe_subscription_id).toBe('sub_test_DUP1');
    expect(opA?.subscription_status).toBe('trialing');
  });

  it('does not touch unrelated tenants', async () => {
    const b = tenants[1]!;
    const { data: opB } = await serviceClient
      .from('operators')
      .select('subscription_status, stripe_subscription_id')
      .eq('id', b.operatorId)
      .single();
    expect(opB?.subscription_status).toBeNull();
    expect(opB?.stripe_subscription_id).toBeNull();
  });
});
