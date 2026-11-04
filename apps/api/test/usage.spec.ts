import type { INestApplication } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@bookingblues/db-types';
import type Stripe from 'stripe';

import { StripeService } from '../src/common/stripe/stripe.service';
import { UsageBillingService } from '../src/modules/usage/usage-billing.service';
import { UsageNotifierService } from '../src/modules/usage/usage-notifier.service';
import { UsageService, type UsageOperator } from '../src/modules/usage/usage.service';
import { buildTestApp } from './helpers/app';
import {
  describeIfSupabase,
  makeServiceClient,
  readTestEnv,
  setupTenants,
  teardownTenants,
  type TestTenant,
} from './helpers/tenants';

process.env.STRIPE_SECRET_KEY ||= 'sk_test_dummy_for_sdk_init';

const ANCHOR = '2026-10-05T12:00:00.000Z';
const IN_WINDOW = new Date('2026-10-20T00:00:00Z');
const phone = (n: number): string => `+1555300${String(n).padStart(4, '0')}`;

describeIfSupabase('Usage metering, limits, alerts and overage billing', () => {
  let app: INestApplication;
  let db: SupabaseClient<Database>;
  let tenants: readonly TestTenant[];
  let usage: UsageService;
  let billing: UsageBillingService;
  let sent: Array<{ kind: string; operatorId: string; subject: string }>;
  let stripeCalls: { invoiceItems: unknown[]; invoices: unknown[]; paid: string[] };
  /** What the fake Stripe "has": invoice items, and live statuses for invoices we didn't create. */
  let stripeState: {
    items: Array<{ id: string; customer: string; invoice: string | null; metadata: Record<string, string> }>;
    invoices: Map<string, { id: string; status: string; metadata: Record<string, string> }>;
  };

  const asyncList = <T>(rows: T[]): AsyncIterable<T> => ({
    async *[Symbol.asyncIterator]() {
      yield* rows;
    },
  });

  const operatorRow = async (id: string): Promise<UsageOperator & { overage_unpaid_invoice_id: string | null }> => {
    const { data, error } = await db
      .from('operators')
      .select('id, user_id, business_name, plan, current_period_start, subscription_status, stripe_subscription_id, overage_unpaid_invoice_id')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  };

  const setPlan = async (id: string, patch: Partial<Database['public']['Tables']['operators']['Update']>) => {
    const { error } = await db
      .from('operators')
      .update({ current_period_start: ANCHOR, trial_ends_at: null, ...patch })
      .eq('id', id);
    if (error) throw error;
  };

  beforeAll(async () => {
    const env = readTestEnv();
    if (!env) throw new Error('no test env');
    db = makeServiceClient(env);
    tenants = await setupTenants(8);
    app = await buildTestApp();
    usage = app.get(UsageService);
    billing = app.get(UsageBillingService);

    const notifier = app.get(UsageNotifierService);
    jest.spyOn(notifier, 'send').mockImplementation(async (kind, target, content) => {
      sent.push({ kind, operatorId: target.id, subject: content.operator.subject });
    });

    type ItemParams = { customer: string; invoice?: string; metadata: Record<string, string> };
    type InvoiceParams = { metadata: Record<string, string> };
    const fakeStripe = {
      invoiceItems: {
        create: jest.fn(async (params: ItemParams) => {
          stripeCalls.invoiceItems.push(params);
          const item = {
            id: `ii_${stripeCalls.invoiceItems.length}`,
            customer: params.customer,
            invoice: params.invoice ?? null,
            metadata: params.metadata,
          };
          stripeState.items.push(item);
          return item;
        }),
        list: jest.fn((params: { customer: string }) =>
          asyncList(stripeState.items.filter((i) => i.customer === params.customer)),
        ),
      },
      invoices: {
        create: jest.fn(async (params: InvoiceParams) => {
          stripeCalls.invoices.push(params);
          const inv = { id: `in_overage_${stripeCalls.invoices.length}`, status: 'draft', metadata: params.metadata };
          stripeState.invoices.set(inv.id, inv);
          return inv;
        }),
        list: jest.fn(() => asyncList([])),
        // Renewal invoices the tests don't register are still drafts.
        retrieve: jest.fn(async (id: string) => stripeState.invoices.get(id) ?? { id, status: 'draft', metadata: {} }),
        finalizeInvoice: jest.fn(async (id: string) => {
          const inv = stripeState.invoices.get(id)!;
          inv.status = 'open';
          return inv;
        }),
        pay: jest.fn(async (id: string) => {
          stripeCalls.paid.push(id);
          return { id };
        }),
      },
      customers: {
        retrieve: jest.fn(async (id: string) => ({ id, invoice_settings: { default_payment_method: null } })),
      },
      subscriptions: {
        retrieve: jest.fn(async (id: string) => ({ id, default_payment_method: 'pm_from_subscription' })),
      },
    };
    jest.spyOn(app.get(StripeService), 'client').mockReturnValue(fakeStripe as unknown as Stripe);
  });

  beforeEach(() => {
    sent = [];
    stripeCalls = { invoiceItems: [], invoices: [], paid: [] };
    stripeState = { items: [], invoices: new Map() };
  });

  const seedPeople = async (
    operatorId: string,
    count: number,
    offset: number,
    extra: { plan?: string; in_trial?: boolean } = {},
  ): Promise<void> => {
    const rows = Array.from({ length: count }, (_, i) => ({
      operator_id: operatorId,
      window_start: ANCHOR,
      caller_phone_e164: phone(i + offset),
      ...extra,
    }));
    const { error } = await db.from('usage_callers').insert(rows);
    if (error) throw error;
  };

  const chargeRow = async (operatorId: string) => {
    const { data, error } = await db
      .from('usage_overage_charges')
      .select('status, amount_cents, stripe_invoice_id')
      .eq('operator_id', operatorId)
      .eq('window_start', ANCHOR)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  const forCustomer = (calls: unknown[], customer: string): unknown[] =>
    calls.filter((p) => (p as { customer?: string }).customer === customer);

  afterAll(async () => {
    await app?.close();
    if (tenants) await teardownTenants(tenants);
  });

  it('Solo: counts unique people, alerts at 80% and 100% once, blocks the 81st new person', async () => {
    const t = tenants[0]!;
    await setPlan(t.operatorId, { plan: 'solo' });
    const op = await operatorRow(t.operatorId);

    for (let i = 1; i <= 80; i += 1) {
      const a = await usage.admitCaller(op, phone(i), IN_WINDOW);
      expect(a.allowed).toBe(true);
    }
    // Same person again: still allowed, not double counted.
    const again = await usage.admitCaller(op, phone(1), IN_WINDOW);
    expect(again).toMatchObject({ allowed: true, used: 80 });

    expect(sent.map((s) => s.kind)).toEqual(['usage_80', 'usage_100']);
    expect(sent[1]!.subject).toMatch(/reached your Solo plan limit/);

    const blocked = await usage.admitCaller(op, phone(81), IN_WINDOW);
    expect(blocked).toMatchObject({ allowed: false, used: 80, limit: 80, policy: 'block' });
    expect(await usage.wouldAdmit(op.id, phone(81), IN_WINDOW)).toBe(false);
    expect(await usage.wouldAdmit(op.id, phone(5), IN_WINDOW)).toBe(true);
    expect(sent).toHaveLength(2); // no repeat alerts

    // Next monthly window resets the count.
    const next = await usage.admitCaller(op, phone(81), new Date('2026-11-06T00:00:00Z'));
    expect(next).toMatchObject({ allowed: true, used: 1 });
  });

  it('Free trial (even on Fleet): blocks the 31st new person, trial emails, full limit once the trial ends', async () => {
    const t = tenants[6]!;
    await setPlan(t.operatorId, {
      plan: 'fleet',
      subscription_status: 'trialing',
      stripe_subscription_id: 'sub_usage_trial_cap',
    });
    const op = await operatorRow(t.operatorId);

    for (let i = 1; i <= 30; i += 1) {
      expect((await usage.admitCaller(op, phone(i), IN_WINDOW)).allowed).toBe(true);
    }
    expect(sent.map((s) => s.kind)).toEqual(['usage_80', 'usage_100']);
    expect(sent[1]!.subject).toMatch(/free-trial limit of 30 people/);

    const blocked = await usage.admitCaller(op, phone(31), IN_WINDOW);
    expect(blocked).toMatchObject({ allowed: false, used: 30, limit: 30, policy: 'block', trial: true });
    expect(await usage.wouldAdmit(op.id, phone(31), IN_WINDOW)).toBe(false);
    expect(await usage.admitCaller(op, phone(7), IN_WINDOW)).toMatchObject({ allowed: true });
    expect(await usage.summary(op, IN_WINDOW)).toMatchObject({ used: 30, limit: 30, trial: true });

    // Trial ended early → paid Fleet rules (1500, overage) on the same counts.
    await setPlan(t.operatorId, { subscription_status: 'active' });
    const paid = await operatorRow(t.operatorId);
    expect(await usage.admitCaller(paid, phone(31), IN_WINDOW)).toMatchObject({
      allowed: true,
      limit: 1500,
      policy: 'overage',
      trial: false,
    });
  });

  it('a comped account (trialing, no Stripe subscription) is not trial-capped', async () => {
    const t = tenants[7]!;
    await setPlan(t.operatorId, { plan: null, subscription_status: 'trialing', stripe_subscription_id: null });
    const op = await operatorRow(t.operatorId);
    expect(await usage.summary(op, IN_WINDOW)).toMatchObject({ limit: null, trial: false });
    for (let i = 1; i <= 31; i += 1) {
      expect((await usage.admitCaller(op, phone(i), IN_WINDOW)).allowed).toBe(true);
    }
  });

  it('Crew monthly: keeps answering past the limit and bills overage on the renewal invoice once', async () => {
    const t = tenants[1]!;
    await setPlan(t.operatorId, { plan: 'crew', plan_cadence: 'monthly', stripe_customer_id: 'cus_usage_crew' });
    const op = await operatorRow(t.operatorId);

    // Seed 551 people in the window (+1 below → 552 → 52 extra → 2 batches = $200).
    const rows = Array.from({ length: 551 }, (_, i) => ({
      operator_id: op.id,
      window_start: ANCHOR,
      caller_phone_e164: phone(i + 1000),
    }));
    const { error } = await db.from('usage_callers').insert(rows);
    if (error) throw error;

    const extra = await usage.admitCaller(op, phone(9999), IN_WINDOW);
    expect(extra).toMatchObject({ allowed: true, used: 552, policy: 'overage' });

    const invoice = {
      id: 'in_renewal_1',
      status: 'draft',
      billing_reason: 'subscription_cycle',
      customer: 'cus_usage_crew',
      currency: 'usd',
      period_start: Date.parse(ANCHOR) / 1000,
      period_end: Date.parse('2026-11-05T12:00:00Z') / 1000,
      metadata: {},
    } as unknown as Stripe.Invoice;

    await billing.onInvoiceCreated(invoice);
    await billing.onInvoiceCreated(invoice); // webhook replay → no second line

    expect(stripeCalls.invoiceItems).toHaveLength(1);
    expect(stripeCalls.invoiceItems[0]).toMatchObject({
      customer: 'cus_usage_crew',
      invoice: 'in_renewal_1',
      amount: 20_000,
    });
    const { data: charge } = await db
      .from('usage_overage_charges')
      .select('status, batches, amount_cents, people_used')
      .eq('operator_id', op.id)
      .single();
    expect(charge).toEqual({ status: 'invoiced', batches: 2, amount_cents: 20_000, people_used: 552 });
  });

  it('never bills a window that ended inside the free trial', async () => {
    const t = tenants[1]!;
    await setPlan(t.operatorId, { trial_ends_at: '2026-11-05T12:00:00Z' });
    await db.from('usage_overage_charges').delete().eq('operator_id', t.operatorId);
    await billing.onInvoiceCreated({
      id: 'in_trial_end',
      status: 'draft',
      billing_reason: 'subscription_cycle',
      customer: 'cus_usage_crew',
      currency: 'usd',
      period_start: Date.parse(ANCHOR) / 1000,
      period_end: Date.parse('2026-11-05T12:00:00Z') / 1000,
      metadata: {},
    } as unknown as Stripe.Invoice);
    expect(stripeCalls.invoiceItems).toHaveLength(0);
  });

  it('Fleet annual: cron bills the closed window on its own invoice; failure pauses, payment resumes', async () => {
    const t = tenants[2]!;
    await setPlan(t.operatorId, {
      plan: 'fleet',
      plan_cadence: 'annual',
      subscription_status: 'active',
      stripe_customer_id: 'cus_usage_fleet',
      stripe_subscription_id: 'sub_usage_fleet',
    });
    await seedPeople(t.operatorId, 1520, 2000);

    // Run "today" in the next window, so Oct 5 – Nov 5 is the closed one.
    const res = await billing.reconcileOverage(new Date('2026-11-06T00:00:00Z'));
    expect(res.billed).toBeGreaterThanOrEqual(1);
    expect(stripeCalls.invoiceItems).toContainEqual(
      expect.objectContaining({ customer: 'cus_usage_fleet', invoice: 'in_overage_1', amount: 10_000 }),
    );
    // Its own invoice, charged to the card Checkout saved on the subscription,
    // and never sweeping up unrelated pending items.
    expect(stripeCalls.invoices).toContainEqual(
      expect.objectContaining({
        customer: 'cus_usage_fleet',
        pending_invoice_items_behavior: 'exclude',
        default_payment_method: 'pm_from_subscription',
      }),
    );
    expect(stripeCalls.paid).toContain('in_overage_1');

    // Second run the same day is a no-op for this operator.
    stripeCalls = { invoiceItems: [], invoices: [], paid: [] };
    await billing.reconcileOverage(new Date('2026-11-06T00:00:00Z'));
    expect(forCustomer(stripeCalls.invoiceItems, 'cus_usage_fleet')).toHaveLength(0);

    const overageInvoice = {
      id: 'in_overage_1',
      amount_due: 10_000,
      hosted_invoice_url: 'https://pay.example/in_overage_1',
      billing_reason: 'manual',
      customer: 'cus_usage_fleet',
      metadata: { kind: 'usage_overage', operator_id: t.operatorId },
    } as unknown as Stripe.Invoice;

    await billing.onInvoicePaymentFailed(overageInvoice);
    await billing.onInvoicePaymentFailed(overageInvoice); // Stripe retry → no second email
    expect((await operatorRow(t.operatorId)).overage_unpaid_invoice_id).toBe('in_overage_1');
    expect(sent.filter((s) => s.kind === 'overage_payment_failed')).toHaveLength(1);

    await billing.onInvoicePaymentSucceeded(overageInvoice);
    expect((await operatorRow(t.operatorId)).overage_unpaid_invoice_id).toBeNull();
    expect(sent.map((s) => s.kind)).toContain('account_resumed');
  });

  it('emails on the first failed renewal attempt and when past_due recovers', async () => {
    const t = tenants[1]!;
    const renewal = {
      id: 'in_renewal_fail',
      amount_due: 65000,
      hosted_invoice_url: 'https://pay.example/in_renewal_fail',
      billing_reason: 'subscription_cycle',
      customer: 'cus_usage_crew',
      metadata: {},
    };
    await billing.onInvoicePaymentFailed({ ...renewal, attempt_count: 1 } as unknown as Stripe.Invoice);
    await billing.onInvoicePaymentFailed({ ...renewal, attempt_count: 2 } as unknown as Stripe.Invoice);
    expect(sent.filter((s) => s.kind === 'subscription_payment_failed')).toHaveLength(1);

    await billing.onSubscriptionStatusChanged(t.operatorId, 'past_due', 'active');
    await billing.onSubscriptionStatusChanged(t.operatorId, 'trialing', 'active');
    expect(sent.filter((s) => s.kind === 'account_resumed')).toHaveLength(1);
  });

  // ── lost-revenue backstops (reconcileOverage) ───────────────────────────────

  it('Crew monthly, late webhook + cancelled + downgraded: overage still billed at the Crew rate', async () => {
    const t = tenants[3]!;
    // Counted 560 people on Crew; since then downgraded to Solo and cancelled.
    await setPlan(t.operatorId, {
      plan: 'solo',
      plan_cadence: 'monthly',
      subscription_status: 'canceled',
      stripe_customer_id: 'cus_usage_lost',
    });
    await seedPeople(t.operatorId, 560, 4000, { plan: 'crew' });

    // invoice.created delivered late (after Stripe finalized the draft): no line, no claim.
    stripeState.invoices.set('in_renewal_late', { id: 'in_renewal_late', status: 'open', metadata: {} });
    await setPlan(t.operatorId, { plan: 'crew' });
    await billing.onInvoiceCreated({
      id: 'in_renewal_late',
      status: 'draft',
      billing_reason: 'subscription_cycle',
      customer: 'cus_usage_lost',
      currency: 'usd',
      period_start: Date.parse(ANCHOR) / 1000,
      period_end: Date.parse('2026-11-05T12:00:00Z') / 1000,
      metadata: {},
    } as unknown as Stripe.Invoice);
    expect(stripeCalls.invoiceItems).toHaveLength(0);
    expect(await chargeRow(t.operatorId)).toBeNull();
    await setPlan(t.operatorId, { plan: 'solo' });

    // Inside the grace period the renewal invoice still gets first go.
    await billing.reconcileOverage(new Date('2026-11-07T00:00:00Z'));
    expect(forCustomer(stripeCalls.invoiceItems, 'cus_usage_lost')).toHaveLength(0);

    // After it: billed on its own invoice — 60 extra → 2 batches = $200.
    await billing.reconcileOverage(new Date('2026-11-10T00:00:00Z'));
    expect(forCustomer(stripeCalls.invoiceItems, 'cus_usage_lost')).toEqual([
      expect.objectContaining({ amount: 20_000 }),
    ]);
    expect(await chargeRow(t.operatorId)).toMatchObject({ status: 'invoiced', amount_cents: 20_000 });

    // And never twice.
    await billing.reconcileOverage(new Date('2026-11-11T00:00:00Z'));
    expect(forCustomer(stripeCalls.invoiceItems, 'cus_usage_lost')).toHaveLength(1);
  });

  it('never bills a window counted during the trial, even after trial_ends_at is cleared', async () => {
    const t = tenants[4]!;
    await setPlan(t.operatorId, {
      plan: 'fleet',
      plan_cadence: 'annual',
      subscription_status: 'canceled',
      stripe_customer_id: 'cus_usage_trial',
    });
    await seedPeople(t.operatorId, 1600, 6000, { plan: 'fleet', in_trial: true });

    await billing.reconcileOverage(new Date('2026-11-10T00:00:00Z'));
    expect(forCustomer(stripeCalls.invoiceItems, 'cus_usage_trial')).toHaveLength(0);
    expect(await chargeRow(t.operatorId)).toMatchObject({ status: 'none', amount_cents: 0 });
  });

  it('finishes a claim that crashed mid-way without billing it twice', async () => {
    const t = tenants[5]!;
    await setPlan(t.operatorId, {
      plan: 'crew',
      plan_cadence: 'annual',
      subscription_status: 'active',
      stripe_customer_id: 'cus_usage_crash',
    });
    // Crashed after Stripe created the invoice + line, before we recorded it.
    const { error } = await db.from('usage_overage_charges').insert({
      operator_id: t.operatorId,
      window_start: ANCHOR,
      window_end: '2026-11-05T12:00:00.000Z',
      people_used: 540,
      people_included: 500,
      batches: 1,
      amount_cents: 10_000,
      status: 'pending',
      updated_at: '2026-11-05T13:00:00.000Z',
    });
    if (error) throw error;
    const meta = { kind: 'usage_overage', operator_id: t.operatorId, window_start: ANCHOR };
    stripeState.invoices.set('in_crashed', { id: 'in_crashed', status: 'draft', metadata: meta });
    stripeState.items.push({ id: 'ii_crashed', customer: 'cus_usage_crash', invoice: 'in_crashed', metadata: meta });

    await billing.reconcileOverage(new Date('2026-11-06T00:00:00Z'));
    expect(forCustomer(stripeCalls.invoiceItems, 'cus_usage_crash')).toHaveLength(0);
    expect(forCustomer(stripeCalls.invoices, 'cus_usage_crash')).toHaveLength(0);
    expect(stripeCalls.paid).toContain('in_crashed'); // finalized + charged
    expect(await chargeRow(t.operatorId)).toMatchObject({ status: 'invoiced', stripe_invoice_id: 'in_crashed' });
  });
});
