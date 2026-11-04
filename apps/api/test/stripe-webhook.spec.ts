import type { INestApplication } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@bookingblues/db-types';
import Stripe from 'stripe';
import request from 'supertest';

import { StripeService } from '../src/common/stripe/stripe.service';
import { TRIAL_GUARD_EFFECTIVE_FROM_UNIX, TrialGuardService } from '../src/modules/billing/trial-guard.service';
import { UsageBillingService } from '../src/modules/usage/usage-billing.service';
import { WebhookReplayService } from '../src/modules/webhooks/webhook-replay.service';
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
process.env.STRIPE_PRICE_SOLO_MONTHLY ||= 'price_test_solo_monthly';
process.env.STRIPE_PRICE_SOLO_ANNUAL ||= 'price_test_solo_annual';
process.env.STRIPE_PRICE_CREW_MONTHLY ||= 'price_test_crew_monthly';
process.env.STRIPE_PRICE_CREW_ANNUAL ||= 'price_test_crew_annual';
process.env.STRIPE_PRICE_FLEET_MONTHLY ||= 'price_test_fleet_monthly';
process.env.STRIPE_PRICE_FLEET_ANNUAL ||= 'price_test_fleet_annual';
process.env.STRIPE_COUPON_FOUNDING_SOLO ||= 'coupon_test_founding_solo';

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
  paymentMethodId?: string;
  couponId?: string;
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
        created: Math.floor(Date.now() / 1000),
        customer: opts.customerId,
        status: opts.status,
        trial_end: opts.trialEndUnix,
        default_payment_method: opts.paymentMethodId ?? null,
        discount: opts.couponId ? { object: 'discount', coupon: { id: opts.couponId } } : null,
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
    tenants = await setupTenants(4);
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

  it('re-processes a delivery that failed (Stripe retry), then acks further duplicates', async () => {
    const billing = app.get(UsageBillingService);
    const spy = jest
      .spyOn(billing, 'onInvoiceCreated')
      .mockRejectedValueOnce(new Error('transient Stripe outage'))
      .mockResolvedValue(undefined);
    const event = {
      id: `evt_retry_${Date.now()}`,
      object: 'event',
      type: 'invoice.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_retry', object: 'invoice', status: 'draft', metadata: {} } },
    };

    expect((await signedRequest(app, event)).status).toBeGreaterThanOrEqual(500);
    expect((await signedRequest(app, event)).status).toBe(200); // retry actually runs
    expect((await signedRequest(app, event)).status).toBe(200); // now a true duplicate
    expect(spy).toHaveBeenCalledTimes(2);

    const { data: row } = await serviceClient
      .from('webhook_events')
      .select('processed_at, attempts')
      .eq('source', 'stripe')
      .eq('event_id', event.id)
      .single();
    expect(row?.processed_at).not.toBeNull();
    expect(row?.attempts).toBe(2);
    spy.mockRestore();
  });

  it('the replay sweeper re-runs a failed event after Stripe has given up', async () => {
    const billing = app.get(UsageBillingService);
    const spy = jest
      .spyOn(billing, 'onInvoiceCreated')
      .mockRejectedValueOnce(new Error('bug, fixed by a later deploy'))
      .mockResolvedValue(undefined);
    const event = {
      id: `evt_replay_${Date.now()}`,
      object: 'event',
      type: 'invoice.created',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'in_replay', object: 'invoice', status: 'draft', metadata: {} } },
    };
    expect((await signedRequest(app, event)).status).toBeGreaterThanOrEqual(500);

    const later = new Date(Date.now() + 10 * 60_000);
    const res = await app.get(WebhookReplayService).replayUnprocessed(later);
    expect(res.replayed).toBeGreaterThanOrEqual(1);
    expect(spy).toHaveBeenCalledTimes(2);

    const { data: row } = await serviceClient
      .from('webhook_events')
      .select('processed_at')
      .eq('source', 'stripe')
      .eq('event_id', event.id)
      .single();
    expect(row?.processed_at).not.toBeNull();
    spy.mockRestore();
  });

  describe('one free trial per person', () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const fingerprint = `fp_test_${stamp}`;
    const phone = `+1555${stamp.slice(-7)}`;
    let fakeStripe: {
      webhooks: Stripe['webhooks'];
      paymentMethods: { retrieve: jest.Mock };
      subscriptions: { update: jest.Mock; deleteDiscount: jest.Mock; retrieve: jest.Mock };
    };

    beforeAll(async () => {
      const [, , c, d] = tenants;
      for (const t of [c!, d!]) {
        const { error } = await serviceClient
          .from('operators')
          .update({ stripe_customer_id: `cus_tg_${t.operatorId.slice(0, 8)}` })
          .eq('id', t.operatorId);
        if (error) throw error;
      }
      // C signed up with a mobile number; D (the repeat signup) did not enter it.
      await serviceClient.from('operators').update({ personal_phone_e164: phone }).eq('id', c!.operatorId);
    });

    beforeEach(() => {
      const real = app.get(StripeService).client();
      fakeStripe = {
        // Signature verification still runs for real.
        webhooks: real.webhooks,
        paymentMethods: { retrieve: jest.fn().mockResolvedValue({ id: 'pm_x', card: { fingerprint } }) },
        subscriptions: {
          update: jest.fn().mockResolvedValue({}),
          deleteDiscount: jest.fn().mockResolvedValue({}),
          retrieve: jest.fn(),
        },
      };
      jest.spyOn(app.get(StripeService), 'client').mockReturnValue(fakeStripe as unknown as Stripe);
    });

    afterEach(() => jest.restoreAllMocks());

    it('the first trial on a card is left alone', async () => {
      const c = tenants[2]!;
      const res = await signedRequest(
        app,
        subscriptionCreatedEvent({
          eventId: `evt_tg_c_${stamp}`,
          customerId: `cus_tg_${c.operatorId.slice(0, 8)}`,
          subscriptionId: `sub_tg_c_${stamp}`,
          status: 'trialing',
          trialEndUnix: Math.floor(Date.now() / 1000) + 7 * 86_400,
          paymentMethodId: 'pm_c',
        }),
      );
      expect(res.status).toBe(200);
      expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('a new account paying with the same card has its trial ended and the Founding coupon removed', async () => {
      const d = tenants[3]!;
      const subId = `sub_tg_d_${stamp}`;
      const res = await signedRequest(
        app,
        subscriptionCreatedEvent({
          eventId: `evt_tg_d_${stamp}`,
          customerId: `cus_tg_${d.operatorId.slice(0, 8)}`,
          subscriptionId: subId,
          status: 'trialing',
          trialEndUnix: Math.floor(Date.now() / 1000) + 7 * 86_400,
          paymentMethodId: 'pm_d',
          couponId: process.env.STRIPE_COUPON_FOUNDING_SOLO!,
        }),
      );
      expect(res.status).toBe(200);
      expect(fakeStripe.subscriptions.deleteDiscount).toHaveBeenCalledWith(subId);
      expect(fakeStripe.subscriptions.update).toHaveBeenCalledWith(subId, {
        trial_end: 'now',
        proration_behavior: 'none',
      });

      const { data: audit } = await serviceClient
        .from('audit_log')
        .select('action, metadata')
        .eq('operator_id', d.operatorId)
        .eq('action', 'trial.ended_duplicate');
      expect(audit).toHaveLength(1);
      expect((audit![0]!.metadata as { matched: string[] }).matched).toEqual(['card']);
    });

    it('a subscription created before the guard shipped keeps its trial (grandfathered)', async () => {
      const d = tenants[3]!;
      const event = subscriptionCreatedEvent({
        eventId: `evt_tg_old_${stamp}`,
        customerId: `cus_tg_${d.operatorId.slice(0, 8)}`,
        subscriptionId: `sub_tg_old_${stamp}`,
        status: 'trialing',
        trialEndUnix: Math.floor(Date.now() / 1000) + 7 * 86_400,
        paymentMethodId: 'pm_d',
      });
      (event as unknown as { data: { object: { created: number } } }).data.object.created =
        TRIAL_GUARD_EFFECTIVE_FROM_UNIX - 3_600;
      const res = await signedRequest(app, event);
      expect(res.status).toBe(200);
      expect(fakeStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it('checkout gives no trial to an email alias or a phone number already used', async () => {
      const guard = app.get(TrialGuardService);
      const [, , c, d] = tenants;
      const alias = c!.email.replace('@', '+again@');
      expect(await guard.hadTrialElsewhere({ id: d!.operatorId, personal_phone_e164: null }, alias)).toBe(true);
      expect(await guard.hadTrialElsewhere({ id: d!.operatorId, personal_phone_e164: phone }, 'new@x.test')).toBe(true);
      expect(await guard.hadTrialElsewhere({ id: d!.operatorId, personal_phone_e164: null }, `fresh_${stamp}@x.test`)).toBe(false);
      // The account that holds the identity is not blocked by itself (returning-customer logic covers it).
      expect(await guard.hadTrialElsewhere({ id: c!.operatorId, personal_phone_e164: phone }, c!.email)).toBe(false);
    });
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
