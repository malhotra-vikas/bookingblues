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
import { type UsageWindow, previousUsageWindow } from './usage-window';

/** Marks our standalone overage invoices (annual plans) and overage line items. */
export const OVERAGE_METADATA_KIND = 'usage_overage';

/** Hooks the Stripe platform webhook calls (see stripe-event-handlers.ts). */
export interface BillingEventHooks {
  onInvoiceCreated(invoice: Stripe.Invoice): Promise<void>;
  onInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void>;
  onInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void>;
  onSubscriptionStatusChanged(operatorId: string, from: string | null, to: string): Promise<void>;
}

const GOOD_STANDING: ReadonlySet<string> = new Set(['trialing', 'active']);

const customerIdOf = (invoice: Stripe.Invoice): string | null =>
  typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null);

const windowLabel = (w: UsageWindow): string => {
  const f = (d: Date): string =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(w.start)} – ${f(new Date(w.end.getTime() - 1))}`;
};

interface BillableOperator {
  id: string;
  plan: string | null;
  plan_cadence: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  stripe_customer_id: string | null;
  overage_unpaid_invoice_id: string | null;
}
const BILLABLE_COLUMNS =
  'id, plan, plan_cadence, trial_ends_at, current_period_start, stripe_customer_id, overage_unpaid_invoice_id';

/**
 * Overage billing for Crew/Fleet ($100 per started batch of 50 extra people per
 * monthly window — see plan-limits.ts) and the failed-payment pause/resume emails.
 *
 *  - Monthly plans: when Stripe drafts the renewal invoice (`invoice.created`,
 *    billing_reason `subscription_cycle`) we add an overage line for the period
 *    that just ended, so it's charged with the subscription.
 *  - Annual plans: the renewal is a year away, so a daily cron bills each closed
 *    monthly window on its own invoice, charged to the card on file.
 *
 * A failed renewal flips the subscription to past_due (existing degraded mode).
 * A failed standalone overage invoice sets `operators.overage_unpaid_invoice_id`,
 * which pauses the AI the same way until it's paid. Both email operator + admins.
 *
 * Windows that ended inside the free trial are never billed.
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
    if (!customerId) return;
    const operator = await this.operatorByCustomer(customerId);
    if (!operator || operator.plan_cadence === 'annual') return; // annual → cron
    const limit = conversationLimitForPlan(operator.plan);
    if (limit == null || overLimitPolicyForPlan(operator.plan) !== 'overage') return;

    const window: UsageWindow = {
      start: new Date(invoice.period_start * 1000),
      end: new Date(invoice.period_end * 1000),
    };
    if (this.endedInTrial(operator, window)) return;

    const used = await this.usage.countPeopleInRange(operator.id, window.start, window.end);
    await this.bill(operator, window, used, limit, async (amountCents, description, idempotencyKey) => {
      const item = await this.stripe.client().invoiceItems.create(
        {
          customer: customerId,
          invoice: invoice.id,
          amount: amountCents,
          currency: invoice.currency,
          description,
          metadata: { kind: OVERAGE_METADATA_KIND, operator_id: operator.id, window_start: window.start.toISOString() },
        },
        { idempotencyKey },
      );
      return { invoiceId: invoice.id ?? null, invoiceItemId: item.id };
    });
  }

  // ── annual plans: daily cron bills each closed monthly window ──────────────

  async closeAnnualWindows(now = new Date()): Promise<{ checked: number; billed: number }> {
    const { data, error } = await this.supabase
      .db()
      .from('operators')
      .select(BILLABLE_COLUMNS)
      .in('plan', ['crew', 'fleet'])
      .eq('plan_cadence', 'annual')
      .eq('subscription_status', 'active')
      .not('stripe_customer_id', 'is', null);
    if (error) throw error;

    let billed = 0;
    for (const operator of data ?? []) {
      try {
        if (await this.billAnnualWindow(operator, now)) billed += 1;
      } catch (err) {
        // One operator's Stripe error must not stop the rest; the claim stays
        // 'pending' so tomorrow's run retries it.
        this.logger.error(
          { operatorId: operator.id, err: (err as Error).message },
          'annual overage billing failed',
        );
      }
    }
    return { checked: data?.length ?? 0, billed };
  }

  private async billAnnualWindow(operator: BillableOperator, now: Date): Promise<boolean> {
    const limit = conversationLimitForPlan(operator.plan);
    const customerId = operator.stripe_customer_id;
    if (limit == null || !customerId) return false;
    const window = previousUsageWindow(operator.current_period_start, now);
    if (this.endedInTrial(operator, window)) return false;

    const used = await this.usage.countPeople(operator.id, window.start);
    return this.bill(operator, window, used, limit, async (amountCents, description, idempotencyKey) => {
      const stripe = this.stripe.client();
      const meta = { kind: OVERAGE_METADATA_KIND, operator_id: operator.id, window_start: window.start.toISOString() };
      const item = await stripe.invoiceItems.create(
        { customer: customerId, amount: amountCents, currency: 'usd', description, metadata: meta },
        { idempotencyKey: `${idempotencyKey}:item` },
      );
      const created = await stripe.invoices.create(
        {
          customer: customerId,
          collection_method: 'charge_automatically',
          auto_advance: true,
          pending_invoice_items_behavior: 'include',
          description: 'KeeprSteady usage overage',
          metadata: meta,
        },
        { idempotencyKey: `${idempotencyKey}:invoice` },
      );
      const finalized = await stripe.invoices.finalizeInvoice(created.id ?? '');
      try {
        await stripe.invoices.pay(finalized.id ?? '');
      } catch (err) {
        // A declined card lands here AND as invoice.payment_failed — the webhook
        // owns the pause + emails, so just note it.
        this.logger.warn(
          { operatorId: operator.id, invoiceId: finalized.id, err: (err as Error).message },
          'overage invoice payment attempt failed',
        );
      }
      return { invoiceId: finalized.id ?? null, invoiceItemId: item.id };
    });
  }

  /**
   * Claim the window, then charge via `charge` if there's overage. Returns true
   * when something was billed. Idempotent: a window already 'none' / 'invoiced'
   * / 'paid' / 'failed' is skipped; a 'pending' one (crashed mid-way) is retried
   * with the same Stripe idempotency key.
   */
  private async bill(
    operator: BillableOperator,
    window: UsageWindow,
    used: number,
    limit: number,
    charge: (
      amountCents: number,
      description: string,
      idempotencyKey: string,
    ) => Promise<{ invoiceId: string | null; invoiceItemId: string }>,
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

    const description =
      `Usage overage ${windowLabel(window)}: ${overage.extraPeople} people over your ${limit} ` +
      `(${overage.batches} × ${OVERAGE_BATCH_SIZE} at $${OVERAGE_BATCH_CENTS / 100})`;
    const result = await charge(overage.amountCents, description, `usage-overage:${operator.id}:${windowStart}`);

    const { error: updErr } = await db
      .from('usage_overage_charges')
      .update({
        status: 'invoiced',
        stripe_invoice_id: result.invoiceId,
        stripe_invoice_item_id: result.invoiceItemId,
      })
      .eq('operator_id', operator.id)
      .eq('window_start', windowStart);
    if (updErr) throw updErr;
    this.logger.info(
      { operatorId: operator.id, windowStart, used, limit, amountCents: overage.amountCents },
      'usage overage billed',
    );
    return true;
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
