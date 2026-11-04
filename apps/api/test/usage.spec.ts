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
  let stripeCalls: { invoiceItems: unknown[]; invoices: unknown[] };

  const operatorRow = async (id: string): Promise<UsageOperator & { overage_unpaid_invoice_id: string | null }> => {
    const { data, error } = await db
      .from('operators')
      .select('id, user_id, business_name, plan, current_period_start, overage_unpaid_invoice_id')
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
    tenants = await setupTenants(3);
    app = await buildTestApp();
    usage = app.get(UsageService);
    billing = app.get(UsageBillingService);

    const notifier = app.get(UsageNotifierService);
    jest.spyOn(notifier, 'send').mockImplementation(async (kind, target, content) => {
      sent.push({ kind, operatorId: target.id, subject: content.operator.subject });
    });

    const fakeStripe = {
      invoiceItems: {
        create: jest.fn(async (params: unknown) => {
          stripeCalls.invoiceItems.push(params);
          return { id: `ii_${stripeCalls.invoiceItems.length}` };
        }),
      },
      invoices: {
        create: jest.fn(async (params: unknown) => {
          stripeCalls.invoices.push(params);
          return { id: 'in_overage_1' };
        }),
        finalizeInvoice: jest.fn(async () => ({ id: 'in_overage_1' })),
        pay: jest.fn(async () => ({ id: 'in_overage_1' })),
      },
    };
    jest.spyOn(app.get(StripeService), 'client').mockReturnValue(fakeStripe as unknown as Stripe);
  });

  beforeEach(() => {
    sent = [];
    stripeCalls = { invoiceItems: [], invoices: [] };
  });

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
    });
    const rows = Array.from({ length: 1520 }, (_, i) => ({
      operator_id: t.operatorId,
      window_start: ANCHOR,
      caller_phone_e164: phone(i + 2000),
    }));
    const { error } = await db.from('usage_callers').insert(rows);
    if (error) throw error;

    // Run "today" in the next window, so Oct 5 – Nov 5 is the closed one.
    const res = await billing.closeAnnualWindows(new Date('2026-11-06T00:00:00Z'));
    expect(res.billed).toBeGreaterThanOrEqual(1);
    expect(stripeCalls.invoiceItems).toContainEqual(expect.objectContaining({ customer: 'cus_usage_fleet', amount: 10_000 }));
    expect(stripeCalls.invoices).toContainEqual(
      expect.objectContaining({ customer: 'cus_usage_fleet', pending_invoice_items_behavior: 'include' }),
    );

    // Second run the same day is a no-op for this operator.
    stripeCalls = { invoiceItems: [], invoices: [] };
    await billing.closeAnnualWindows(new Date('2026-11-06T00:00:00Z'));
    expect(stripeCalls.invoiceItems.filter((p) => (p as { customer: string }).customer === 'cus_usage_fleet')).toHaveLength(0);

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
});
