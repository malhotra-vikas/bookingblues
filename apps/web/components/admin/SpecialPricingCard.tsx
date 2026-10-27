'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmModal } from '../ConfirmModal';
import { PLANS, type PlanSlug } from '../../lib/brand';
import {
  regularPriceLabel,
  specialPriceLabel,
  specialPricingOf,
  type SpecialPricingFields,
} from '../../lib/special-pricing';
import { postJson } from './OperatorActions';

interface Props {
  readonly operator: SpecialPricingFields & {
    readonly id: string;
    readonly plan: string | null;
    readonly plan_cadence: string | null;
    readonly has_subscription: boolean;
    readonly special_price_coupon_id: string | null;
  };
}

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-accent focus:outline-none';

/**
 * Admin control for one operator's special pricing ("$50/mo for 6 months").
 * The API creates the Stripe coupon; a subscribed operator gets it on their
 * live subscription, otherwise it is applied when they check out.
 */
export function SpecialPricingCard({ operator }: Props): JSX.Element {
  const router = useRouter();
  const current = specialPricingOf(operator);
  // A subscribed operator can only get special pricing on the plan they're on.
  const locked = operator.has_subscription && operator.plan != null;
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState<PlanSlug>(
    (current?.plan ?? (operator.plan as PlanSlug | null) ?? 'solo') as PlanSlug,
  );
  const [cadence, setCadence] = useState<'monthly' | 'annual'>(
    current?.cadence ?? (operator.plan_cadence === 'annual' ? 'annual' : 'monthly'),
  );
  const [price, setPrice] = useState(current ? String(current.priceUsd) : '');
  const [periods, setPeriods] = useState(current ? String(current.periods) : '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearReason, setClearReason] = useState('');

  const base = PLANS.find((p) => p.slug === plan);
  const regular = base ? (cadence === 'annual' ? base.annualPriceUsd : base.monthlyPriceUsd) : null;
  const unit = cadence === 'annual' ? 'year' : 'month';

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const priceCents = Math.round(Number(price) * 100);
    const n = Number(periods);
    if (!Number.isFinite(priceCents) || priceCents < 0) return setError('Enter a price of $0 or more');
    if (regular != null && priceCents >= regular * 100) {
      return setError(`The special price must be below the regular $${regular.toLocaleString()}/${cadence === 'annual' ? 'yr' : 'mo'}`);
    }
    if (!Number.isInteger(n) || n < 1 || n > 60) return setError(`Enter between 1 and 60 ${unit}s`);
    if (!reason.trim()) return setError('Reason is required');
    setBusy(true);
    try {
      await postJson(`/v1/admin/operators/${operator.id}/special-pricing`, {
        plan,
        cadence,
        price_cents: priceCents,
        periods: n,
        reason,
      });
      setEditing(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold dark:text-slate-100">Special pricing</h2>
          {current ? (
            <p className="mt-1 text-sm dark:text-slate-200">
              <span className="font-medium">{current.planName}</span>: {specialPriceLabel(current)}, then{' '}
              {regularPriceLabel(current)}.{' '}
              <span className="text-xs text-muted dark:text-slate-400">
                {operator.has_subscription
                  ? 'Applied to their subscription.'
                  : 'Applies when they start their subscription.'}
                {operator.special_price_coupon_id ? ` Coupon ${operator.special_price_coupon_id}.` : ''}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted dark:text-slate-400">
              None — this operator pays the regular price (plus the Founding promo while it runs).
            </p>
          )}
        </div>
        {!editing ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
              className="rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {current ? 'Change' : 'Set special pricing'}
            </button>
            {current ? (
              <button
                type="button"
                onClick={() => {
                  setClearReason('');
                  setConfirmClear(true);
                }}
                className="rounded-md border border-red-300 dark:border-red-700 px-3 py-1.5 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-4">
          <label className="block text-xs text-muted dark:text-slate-400">
            Plan
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as PlanSlug)}
              disabled={locked}
              className={inputClass}
            >
              {PLANS.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-muted dark:text-slate-400">
            Billing
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as 'monthly' | 'annual')}
              disabled={locked}
              className={inputClass}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </label>
          <label className="block text-xs text-muted dark:text-slate-400">
            Price per {unit} ($)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={regular != null ? `regular ${regular}` : ''}
              className={inputClass}
              required
            />
          </label>
          <label className="block text-xs text-muted dark:text-slate-400">
            For how many {unit}s
            <input
              type="number"
              min="1"
              max="60"
              step="1"
              value={periods}
              onChange={(e) => setPeriods(e.target.value)}
              className={inputClass}
              required
            />
          </label>
          <label className="block text-xs text-muted dark:text-slate-400 sm:col-span-4">
            Reason (required, recorded in audit log)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} required />
          </label>
          <p className="text-xs text-muted dark:text-slate-400 sm:col-span-4">
            {locked
              ? `They're subscribed to ${base?.name ?? operator.plan} (${operator.plan_cadence}), so the new price goes onto their subscription right away. `
              : 'They see this price when they choose this plan, and it is applied at checkout. '}
            After the last discounted {unit} they pay the regular price
            {regular != null ? ` ($${regular.toLocaleString()}/${cadence === 'annual' ? 'yr' : 'mo'})` : ''}.
          </p>
          {error ? (
            <p className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300 sm:col-span-4">
              {error}
            </p>
          ) : null}
          <div className="flex gap-2 sm:col-span-4">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save special pricing'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm dark:text-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <ConfirmModal
        open={confirmClear}
        title="Remove special pricing?"
        severity="warning"
        confirmLabel="Remove"
        body={
          <div className="space-y-3">
            <p>
              {operator.has_subscription
                ? 'The discount comes off their subscription now; their next invoice is at the regular price.'
                : 'They will see and pay the regular price when they subscribe.'}
            </p>
            <label className="block text-xs text-muted dark:text-slate-400">
              Reason (required, recorded in audit log)
              <textarea
                value={clearReason}
                onChange={(e) => setClearReason(e.target.value)}
                className={inputClass}
                rows={2}
                required
              />
            </label>
          </div>
        }
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          if (!clearReason.trim()) throw new Error('Reason is required');
          await postJson(`/v1/admin/operators/${operator.id}/special-pricing/clear`, {
            reason: clearReason,
          });
          setConfirmClear(false);
          router.refresh();
        }}
      />
    </div>
  );
}
