import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type Stripe from 'stripe';

import { StripeService } from '../../common/stripe/stripe.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  OVERAGE_BATCH_CENTS,
  OVERAGE_BATCH_SIZE,
  conversationLimitForPlan,
  overageFor,
  overLimitPolicyForPlan,
} from '../billing/plan-limits';
import { accountResumedEmail, paymentFailedEmail } from './usage-emails';
import { UsageNotifierService } from './usage-notifier.service';
import { UsageService } from './usage.service';
import { type UsageWindow, addMonthsClamped, usageWindow } from './usage-window';

/** Marks our standalone overage invoices and overage line items. */
export const OVERAGE_METADATA_KIND = 'usage_overage';

/** Hooks the Stripe platform webhook calls (see stripe-event-handlers.ts). */
export interface BillingEventHooks {
  onInvoiceCreated(invoice: Stripe.Invoice): Promise<void>;
  onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void>;
  onInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void>;
  onSubscriptionStatusChanged(operatorId: string, from: string | null, to: string): Promise<void>;
}

export interface ReconcileResult {
  readonly checked: number;
  readonly billed: number;
  readonly failed: number;
}

const GOOD_STANDING: ReadonlySet<string> = new Set(['trialing', 'active']);

/**
 * Monthly plans: how long after a window closes the backstop waits before
 * billing it on its own invoice. Stripe holds a renewal draft for up to 72h
 * while `invoice.created` keeps failing, so past this the renewal-invoice path
 * can no longer add the line.
 */
const MONTHLY_GRACE_MS = 4 * 24 * 60 * 60_000;
/** A claim stuck in 'pending' this long crashed mid-way; finish it. */
const PENDING_STALE_MS = 60 * 60_000;
/** Shortest possible window (28-day month); only windows older than this can be closed. */
const MIN_WINDOW_MS = 27 * 24 * 60 * 60_000;

const customerIdOf = (invoice: Stripe.Invoice): string | null =>
  typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null);

const idOf = (ref: string | { id?: string } | null | undefined): string | null =>
  typeof ref === 'string' ? ref : (ref?.id ?? null);

const windowLabel = (w: UsageWindow): string => {
  const f = (d: Date): string =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(w.start)} – ${f(new Date(w.end.getTime() - 1))}`;
};

const overageDescription = (window: UsageWindow, used: number, limit: number): string => {
  const overage = overageFor(used, limit);
  return (
    `Usage overage ${windowLabel(window)}: ${overage.extraPeople} people over your ${limit} ` +
    `(${overage.batches} × ${OVERAGE_BATCH_SIZE} at $${OVERAGE_BATCH_CENTS / 100})`
  );
};

const idempotencyKeyFor = (operatorId: string, windowStartIso: string): string =>
  `usage-overage:${operatorId}:${windowStartIso}`;

interface BillableOperator {
  id: string;
  plan: string | null;
  plan_cadence: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  overage_unpaid_invoice_id: string | null;
}
const BILLABLE_COLUMNS =
  'id, plan, plan_cadence, trial_ends_at, current_period_start, stripe_customer_id, stripe_subscription_id, overage_unpaid_invoice_id';

type ChargeFn = (
  amountCents: number,
  description: string,
  idempotencyKey: string,
) => Promise<{ invoiceId: string | null; invoiceItemId: string }>;

/**
 * Overage billing for Crew/Fleet ($100 per started batch of 50 extra people per
 * monthly window — see plan-limits.ts) and the failed-payment pause/resume emails.
 *
 *  - Monthly plans, primary path: when Stripe drafts the renewal invoice
 *    (`invoice.created`, billing_reason `subscription_cycle`) we add an overage
 *    line for the period that just ended, so it's charged with the subscription.
 *  - Everything else — annual plans, and every monthly window the renewal path
 *    missed (cancelled before renewal, downgraded, webhook failed until the
 *    draft finalized, crash mid-way) — is caught by `reconcileOverage`, a daily
 *    cron that bills each closed, unbilled window on its own invoice.
 *
 * `usage_overage_charges` (unique per operator+window) is the claim that keeps a
 * window from being billed twice; before charging a standalone invoice we also
 * look the line up in Stripe, so a crash between Stripe and our DB can't
 * double-bill either.
 *
 * A failed renewal flips the subscription to past_due (existing degraded mode).
 * A failed standalone overage invoice sets `operators.overage_unpaid_invoice_id`,
 * which pauses the AI the same way until it's paid. Both email operator + admins.
 *
 * Windows counted during the free trial are never billed.
 */
@Injectable()
export class UsageBillingService implements BillingEventHooks {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly stripe: StripeService,
    private readonly usage: UsageService,
    private readonly notifier: UsageNotifierService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UsageBillingService.name);
  }

  // ── monthly plans: add overage to the renewal invoice ──────────────────────

  async onInvoiceCreated(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.status !== 'draft' || invoice.billing_reason !== 'subscription_cycle') return;
    const customerId = customerIdOf(invoice);
    if (!customerId || !invoice.id) return;
    const operator = await this.operatorByCustomer(customerId);
    if (!operator || operator.plan_cadence === 'annual') return; // annual → reconcileOverage
    const limit = conversationLimitForPlan(operator.plan);
    if (limit == null || overLimitPolicyForPlan(operator.plan) !== 'overage') return;

    const window: UsageWindow = {
      start: new Date(invoice.period_start * 1000),
      end: new Date(invoice.period_end * 1000),
    };
    if (this.endedInTrial(operator, window)) return;

    // A retried delivery can land after Stripe finalized the draft, when lines
    // can no longer be added. Leave the window unclaimed: reconcileOverage bills
    // it on its own invoice once the grace period passes.
    const live = await this.stripe.client().invoices.retrieve(invoice.id);
    if (live.status !== 'draft') {
      this.logger.warn(
        { operatorId: operator.id, invoiceId: invoice.id, status: live.status },
        'renewal invoice no longer a draft; overage left to the reconcile cron',
      );
      return;
    }

    const invoiceId = invoice.id;
    const used = await this.usage.countPeopleInRange(operator.id, window.start, window.end);
    await this.bill(operator, window, used, limit, async (amountCents, description, idempotencyKey) => {
      // A retry after a crash (or after the 24h idempotency key expired) must not add a second line.
      const existing = await this.findOverageItem(customerId, window.start.toISOString());
      if (existing) return { invoiceId: idOf(existing.invoice), invoiceItemId: existing.id };
      const item = await this.stripe.client().invoiceItems.create(
        {
          customer: customerId,
          invoice: invoiceId,
          amount: amountCents,
          currency: invoice.currency,
          description,
          metadata: { kind: OVERAGE_METADATA_KIND, operator_id: operator.id, window_start: window.start.toISOString() },
        },
        { idempotencyKey },
      );
      return { invoiceId, invoiceItemId: item.id };
    });
  }

  // ── backstop: daily cron bills every closed, unbilled window ───────────────

  /**
   * Bills every closed usage window that has no overage claim yet (annual plans,
   * and monthly windows the renewal invoice missed), and finishes claims that
   * crashed mid-way. Idempotent; run daily. One operator's failure never stops
   * the rest — it's logged at error level and retried on the next run.
   */
  async reconcileOverage(now = new Date()): Promise<ReconcileResult> {
    const db = this.supabase.db();
    let billed = 0;
    let failed = 0;

    // 1. Claims stuck in 'pending' (crashed between claiming and recording the invoice).
    const { data: stuck, error: stuckErr } = await db
      .from('usage_overage_charges')
      .select('operator_id, window_start, window_end, people_used, people_included')
      .eq('status', 'pending')
      .lt('updated_at', new Date(now.getTime() - PENDING_STALE_MS).toISOString());
    if (stuckErr) throw stuckErr;

    // 2. Windows with people in them and no claim at all.
    const { data: candidates, error: candErr } = await db.rpc('usage_unbilled_windows', {
      p_started_before: new Date(now.getTime() - MIN_WINDOW_MS).toISOString(),
    });
    if (candErr) throw candErr;

    const operatorIds = [
      ...new Set([...(stuck ?? []).map((r) => r.operator_id), ...(candidates ?? []).map((c) => c.operator_id)]),
    ];
    const operators = await this.operatorsById(operatorIds);

    for (const row of stuck ?? []) {
      const operator = operators.get(row.operator_id);
      try {
        if (!operator) throw new Error('operator not found');
        const window = { start: new Date(row.window_start), end: new Date(row.window_end) };
        // A monthly claim may belong to a renewal draft whose webhook is still
        // being retried; wait until that draft can no longer take the line.
        if (operator.plan_cadence !== 'annual' && now.getTime() < window.end.getTime() + MONTHLY_GRACE_MS) continue;
        await this.chargeAndRecord(operator, window, row.people_used, row.people_included, (amount, desc, key) =>
          this.chargeStandalone(operator, window, amount, desc, key),
        );
        billed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          { operatorId: row.operator_id, windowStart: row.window_start, err: (err as Error).message },
          'overage reconcile: finishing a pending charge failed',
        );
      }
    }

    for (const cand of candidates ?? []) {
      const operator = operators.get(cand.operator_id);
      try {
        if (!operator) throw new Error('operator not found');
        if (await this.reconcileWindow(operator, cand, now)) billed += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(
          { operatorId: cand.operator_id, windowStart: cand.window_start, err: (err as Error).message },
          'overage reconcile: billing a closed window failed',
        );
      }
    }

    return { checked: (stuck?.length ?? 0) + (candidates?.length ?? 0), billed, failed };
  }

  private async reconcileWindow(
    operator: BillableOperator,
    cand: { window_start: string; people: number; plan: string | null; in_trial: boolean },
    now: Date,
  ): Promise<boolean> {
    const start = new Date(cand.window_start);
    const current = usageWindow(operator.current_period_start, now);
    if (start.getTime() >= current.start.getTime()) return false; // still open
    const window: UsageWindow = { start, end: this.closedWindowEnd(operator, start, current.start) };
    // Monthly plans: the renewal invoice gets first go at it.
    if (operator.plan_cadence !== 'annual' && now.getTime() < window.end.getTime() + MONTHLY_GRACE_MS) return false;

    // Bill at the plan the people were counted under, not today's plan.
    const plan = cand.plan ?? operator.plan;
    const limit = conversationLimitForPlan(plan);
    if (limit == null) return false; // no plan → no limit (comped/legacy); nothing to bill
    const inTrial = cand.in_trial || this.startedInTrial(operator, start);
    if (inTrial || overLimitPolicyForPlan(plan) !== 'overage') {
      await this.recordNone(operator, window, cand.people, limit);
      return false;
    }
    if (!operator.stripe_customer_id) {
      throw new Error('overage owed but operator has no Stripe customer');
    }
    return this.bill(operator, window, cand.people, limit, (amount, desc, key) =>
      this.chargeStandalone(operator, window, amount, desc, key),
    );
  }

  /**
   * Bill a closed window on its own invoice, charged to the card on file.
   * Looks in Stripe first so a retry after a crash reuses what's already there
   * (on a renewal invoice or a standalone one) instead of billing twice.
   */
  private async chargeStandalone(
    operator: BillableOperator,
    window: UsageWindow,
    amountCents: number,
    description: string,
    idempotencyKey: string,
  ): Promise<{ invoiceId: string | null; invoiceItemId: string }> {
    const stripe = this.stripe.client();
    const customerId = operator.stripe_customer_id;
    if (!customerId) throw new Error('operator has no Stripe customer');
    const windowStart = window.start.toISOString();
    const meta = { kind: OVERAGE_METADATA_KIND, operator_id: operator.id, window_start: windowStart };

    const existingItem = await this.findOverageItem(customerId, windowStart);
    const existingInvoiceId = idOf(existingItem?.invoice);
    if (existingItem && existingInvoiceId) {
      await this.settleOverageInvoice(operator.id, existingInvoiceId);
      return { invoiceId: existingInvoiceId, invoiceItemId: existingItem.id };
    }

    // Invoice first, then the line attached to it — so unrelated pending items
    // (prorations) are never swept onto an overage invoice.
    let invoice = await this.findOverageDraft(customerId, windowStart);
    if (!invoice) {
      const paymentMethod = await this.defaultPaymentMethod(operator);
      invoice = await stripe.invoices.create(
        {
          customer: customerId,
          collection_method: 'charge_automatically',
          auto_advance: true,
          pending_invoice_items_behavior: 'exclude',
          description: 'KeeprSteady usage overage',
          metadata: meta,
          ...(paymentMethod ? { default_payment_method: paymentMethod } : {}),
        },
        { idempotencyKey: `${idempotencyKey}:invoice` },
      );
    }
    const invoiceId = invoice.id ?? '';
    const item =
      existingItem ??
      (await stripe.invoiceItems.create(
        { customer: customerId, invoice: invoiceId, amount: amountCents, currency: 'usd', description, metadata: meta },
        { idempotencyKey: `${idempotencyKey}:item` },
      ));
    await this.settleOverageInvoice(operator.id, invoiceId);
    return { invoiceId, invoiceItemId: item.id };
  }

  /** Finalize + attempt payment on one of our overage invoices, whatever state a crash left it in. */
  private async settleOverageInvoice(operatorId: string, invoiceId: string): Promise<void> {
    const stripe = this.stripe.client();
    let invoice = await stripe.invoices.retrieve(invoiceId);
    // A line on a subscription renewal invoice: Stripe collects that itself.
    if (invoice.metadata?.['kind'] !== OVERAGE_METADATA_KIND) return;
    if (invoice.status === 'draft') invoice = await stripe.invoices.finalizeInvoice(invoiceId);
    if (invoice.status !== 'open') return;
    try {
      await stripe.invoices.pay(invoiceId);
    } catch (err) {
      // A declined card lands here AND as invoice.payment_failed — the webhook
      // owns the pause + emails, so just note it.
      this.logger.warn({ operatorId, invoiceId, err: (err as Error).message }, 'overage invoice payment attempt failed');
    }
  }

  private async findOverageItem(customerId: string, windowStart: string): Promise<Stripe.InvoiceItem | null> {
    for await (const item of this.stripe.client().invoiceItems.list({ customer: customerId, limit: 100 })) {
      if (item.metadata?.['kind'] === OVERAGE_METADATA_KIND && item.metadata['window_start'] === windowStart) {
        return item;
      }
    }
    return null;
  }

  private async findOverageDraft(customerId: string, windowStart: string): Promise<Stripe.Invoice | null> {
    for await (const inv of this.stripe.client().invoices.list({ customer: customerId, status: 'draft', limit: 100 })) {
      if (inv.metadata?.['kind'] === OVERAGE_METADATA_KIND && inv.metadata['window_start'] === windowStart) return inv;
    }
    return null;
  }

  /**
   * Checkout saves the card on the subscription, not as the customer's invoice
   * default — so a one-off invoice must be pointed at it explicitly or it can't
   * be charged.
   */
  private async defaultPaymentMethod(operator: BillableOperator): Promise<string | null> {
    const stripe = this.stripe.client();
    if (!operator.stripe_customer_id) return null;
    const customer = await stripe.customers.retrieve(operator.stripe_customer_id);
    if (customer.deleted) throw new Error('Stripe customer is deleted');
    if (customer.invoice_settings?.default_payment_method) return null; // Stripe uses it already
    if (!operator.stripe_subscription_id) return null;
    const sub = await stripe.subscriptions.retrieve(operator.stripe_subscription_id);
    return idOf(sub.default_payment_method);
  }

  /**
   * Claim the window, then charge via `charge` if there's overage. Returns true
   * when something was billed. Idempotent: a window already 'none' / 'invoiced'
   * / 'paid' / 'failed' is skipped; a 'pending' one (crashed mid-way) is retried.
   */
  private async bill(
    operator: BillableOperator,
    window: UsageWindow,
    used: number,
    limit: number,
    charge: ChargeFn,
  ): Promise<boolean> {
    const overage = overageFor(used, limit);
    const windowStart = window.start.toISOString();
    const db = this.supabase.db();

    const { error: claimErr } = await db.from('usage_overage_charges').insert({
      operator_id: operator.id,
      window_start: windowStart,
      window_end: window.end.toISOString(),
      people_used: used,
      people_included: limit,
      batches: overage.batches,
      amount_cents: overage.amountCents,
      status: overage.amountCents > 0 ? 'pending' : 'none',
    });
    if (claimErr) {
      if (claimErr.code !== '23505') throw claimErr;
      const { data: prior, error } = await db
        .from('usage_overage_charges')
        .select('status')
        .eq('operator_id', operator.id)
        .eq('window_start', windowStart)
        .maybeSingle();
      if (error) throw error;
      if (prior?.status !== 'pending') return false;
    }
    if (overage.amountCents === 0) return false;
    await this.chargeAndRecord(operator, window, used, limit, charge);
    return true;
  }

  /** Charge an already-claimed window and mark the claim 'invoiced'. */
  private async chargeAndRecord(
    operator: BillableOperator,
    window: UsageWindow,
    used: number,
    limit: number,
    charge: ChargeFn,
  ): Promise<void> {
    const windowStart = window.start.toISOString();
    const { amountCents } = overageFor(used, limit);
    const result = await charge(
      amountCents,
      overageDescription(window, used, limit),
      idempotencyKeyFor(operator.id, windowStart),
    );

    const { error: updErr } = await this.supabase
      .db()
      .from('usage_overage_charges')
      .update({
        status: 'invoiced',
        stripe_invoice_id: result.invoiceId,
        stripe_invoice_item_id: result.invoiceItemId,
      })
      .eq('operator_id', operator.id)
      .eq('window_start', windowStart);
    if (updErr) throw updErr;
    this.logger.info({ operatorId: operator.id, windowStart, used, limit, amountCents }, 'usage overage billed');
  }

  /** Record a closed window that owes nothing, so the backstop stops re-checking it. */
  private async recordNone(operator: BillableOperator, window: UsageWindow, used: number, limit: number): Promise<void> {
    const { error } = await this.supabase.db().from('usage_overage_charges').insert({
      operator_id: operator.id,
      window_start: window.start.toISOString(),
      window_end: window.end.toISOString(),
      people_used: used,
      people_included: limit,
      batches: 0,
      amount_cents: 0,
      status: 'none',
    });
    if (error && error.code !== '23505') throw error;
  }

  // ── failed payment → pause + email; recovery → resume + email ──────────────

  async onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.metadata?.['kind'] === OVERAGE_METADATA_KIND) {
      const operatorId = invoice.metadata['operator_id'];
      if (!operatorId || !invoice.id) return;
      await this.markOverageCharge(invoice.id, 'failed');
      const { data: op, error } = await this.supabase
        .db()
        .from('operators')
        .select('overage_unpaid_invoice_id')
        .eq('id', operatorId)
        .maybeSingle();
      if (error) throw error;
      if (!op || op.overage_unpaid_invoice_id === invoice.id) return; // already paused + emailed
      const { error: updErr } = await this.supabase
        .db()
        .from('operators')
        .update({ overage_unpaid_invoice_id: invoice.id })
        .eq('id', operatorId);
      if (updErr) throw updErr;
      await this.notifyPaymentFailed(operatorId, invoice, true);
      return;
    }

    // Subscription renewal: Stripe already moves the sub to past_due (the pause).
    // Email on the first failed attempt only, not on every Smart Retry.
    if (!invoice.billing_reason?.startsWith('subscription')) return;
    if ((invoice.attempt_count ?? 0) > 1) return;
    const customerId = customerIdOf(invoice);
    const operator = customerId ? await this.operatorByCustomer(customerId) : null;
    if (!operator) return;
    await this.notifyPaymentFailed(operator.id, invoice, false);
  }

  async onInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (invoice.metadata?.['kind'] !== OVERAGE_METADATA_KIND || !invoice.id) return;
    await this.markOverageCharge(invoice.id, 'paid');
    const operatorId = invoice.metadata['operator_id'];
    if (!operatorId) return;
    const { data: cleared, error } = await this.supabase
      .db()
      .from('operators')
      .update({ overage_unpaid_invoice_id: null })
      .eq('id', operatorId)
      .eq('overage_unpaid_invoice_id', invoice.id)
      .select('id, subscription_status');
    if (error) throw error;
    const row = cleared?.[0];
    if (row && row.subscription_status && GOOD_STANDING.has(row.subscription_status)) {
      await this.notifyResumed(operatorId);
    }
  }

  async onSubscriptionStatusChanged(operatorId: string, from: string | null, to: string): Promise<void> {
    if (from !== 'past_due' || !GOOD_STANDING.has(to)) return;
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select('overage_unpaid_invoice_id')
      .eq('id', operatorId)
      .maybeSingle();
    if (error) throw error;
    if (data?.overage_unpaid_invoice_id) return; // still paused for an unpaid overage invoice
    await this.notifyResumed(operatorId);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private endedInTrial(operator: BillableOperator, window: UsageWindow): boolean {
    if (!operator.trial_ends_at) return false;
    // 1-minute slack: a trial-period invoice's period_end equals trial_end.
    return new Date(operator.trial_ends_at).getTime() >= window.end.getTime() - 60_000;
  }

  /** The trial window starts before the trial ends (the anchor moves at conversion). */
  private startedInTrial(operator: BillableOperator, windowStart: Date): boolean {
    if (!operator.trial_ends_at) return false;
    return windowStart.getTime() < new Date(operator.trial_ends_at).getTime() - 60_000;
  }

  /**
   * End of a closed window. Normally it's on the operator's current anchor
   * grid; if the anchor has moved since (trial → paid, plan change), it ended
   * no later than a month on and no later than the current window's start.
   */
  private closedWindowEnd(operator: BillableOperator, start: Date, currentStart: Date): Date {
    const onGrid = usageWindow(operator.current_period_start, start);
    if (onGrid.start.getTime() === start.getTime()) return onGrid.end;
    const monthOn = addMonthsClamped(start, 1);
    return monthOn.getTime() < currentStart.getTime() ? monthOn : currentStart;
  }

  private async operatorByCustomer(customerId: string): Promise<BillableOperator | null> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select(BILLABLE_COLUMNS)
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  private async operatorsById(ids: readonly string[]): Promise<Map<string, BillableOperator>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.supabase.db().from('operators').select(BILLABLE_COLUMNS).in('id', [...ids]);
    if (error) throw error;
    return new Map((data ?? []).map((o) => [o.id, o]));
  }

  private async markOverageCharge(invoiceId: string, status: 'paid' | 'failed'): Promise<void> {
    const { error } = await this.supabase
      .db()
      .from('usage_overage_charges')
      .update({ status })
      .eq('stripe_invoice_id', invoiceId);
    if (error) throw error;
  }

  private async notifyPaymentFailed(operatorId: string, invoice: Stripe.Invoice, isOverage: boolean): Promise<void> {
    const target = await this.notifier.loadOperatorRef(operatorId);
    if (!target) return;
    await this.notifier.send(
      isOverage ? 'overage_payment_failed' : 'subscription_payment_failed',
      target,
      paymentFailedEmail({
        operator: target,
        amountDueCents: invoice.amount_due,
        payUrl: invoice.hosted_invoice_url ?? null,
        isOverageInvoice: isOverage,
        appUrl: this.notifier.appUrl,
      }),
    );
  }

  private async notifyResumed(operatorId: string): Promise<void> {
    const target = await this.notifier.loadOperatorRef(operatorId);
    if (!target) return;
    await this.notifier.send('account_resumed', target, accountResumedEmail({ operator: target, appUrl: this.notifier.appUrl }));
  }
}
