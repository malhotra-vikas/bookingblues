'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { PLANS, depositLabel, type Plan } from '../../../lib/brand';

type Cadence = 'monthly' | 'annual';

export function PricingTiers(): JSX.Element {
  const [cadence, setCadence] = useState<Cadence>('monthly');

  return (
    <>
      <div className="mt-8 flex justify-center">
        <div
          role="tablist"
          aria-label="Billing cadence"
          className="inline-flex rounded-full border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 text-sm"
        >
          <CadenceTab active={cadence === 'monthly'} onClick={() => setCadence('monthly')}>
            Monthly
          </CadenceTab>
          <CadenceTab active={cadence === 'annual'} onClick={() => setCadence('annual')}>
            Annual <span className="ml-1 rounded-full bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold px-1.5 py-0.5">Save 2 months</span>
          </CadenceTab>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <TierCard key={plan.slug} plan={plan} cadence={cadence} />
        ))}
      </div>
    </>
  );
}

function CadenceTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 transition-colors ${
        active
          ? 'bg-accent text-white shadow-sm'
          : 'text-muted hover:text-ink dark:hover:text-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function TierCard({ plan, cadence }: { plan: Plan; cadence: Cadence }): JSX.Element {
  const monthlyEquivalent =
    cadence === 'annual' ? Math.round((plan.annualPriceUsd / 12) * 100) / 100 : plan.monthlyPriceUsd;
  const annualSavings = plan.monthlyPriceUsd * 12 - plan.annualPriceUsd;
  const recommended = plan.recommended;

  return (
    <div
      className={`relative rounded-xl border bg-white dark:bg-slate-900 p-6 flex flex-col ${
        recommended
          ? 'border-accent shadow-md ring-1 ring-accent/30'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      {recommended ? (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-block rounded-full bg-accent text-white text-[11px] font-semibold tracking-wide uppercase px-3 py-1 shadow-sm">
          Most popular
        </span>
      ) : null}

      <div className="text-sm uppercase tracking-wide text-muted">{plan.name}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-4xl font-semibold text-ink dark:text-slate-100">
          ${cadence === 'annual' ? monthlyEquivalent.toLocaleString() : plan.monthlyPriceUsd.toLocaleString()}
        </span>
        <span className="text-base text-muted">/mo</span>
      </div>
      {cadence === 'annual' ? (
        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
          ${plan.annualPriceUsd.toLocaleString()}/yr — save ${annualSavings.toLocaleString()}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">
          Or ${plan.annualPriceUsd.toLocaleString()}/yr — 2 months free
        </p>
      )}

      <ul className="mt-5 space-y-2 text-sm text-ink dark:text-slate-100">
        <Bullet>
          <strong>{plan.conversationsPerMonth.toLocaleString()} AI conversations/mo</strong>{' '}
          <span className="text-muted">
            (~{plan.approxMessagesPerMonth.toLocaleString()} messages in+out)
          </span>
        </Bullet>
        {plan.features.map((feature) => (
          <Bullet key={feature}>{feature}</Bullet>
        ))}
      </ul>

      <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2 text-sm">
        <Row label="Deposit collection" value={depositLabel(plan.depositMode)} />
        <Row
          label="Platform fee"
          value={
            <span>
              <strong>+{plan.platformFeePct}%</strong> on top of your deposit — charged to the
              customer
            </span>
          }
          tooltip="You always receive 100% of your deposit. The platform fee is added on top and paid by the customer at booking."
        />
      </div>

      <Link
        href="/signup"
        className={`mt-6 inline-block text-center rounded-md px-4 py-2.5 text-base font-medium no-underline transition-colors ${
          recommended
            ? 'bg-accent text-white hover:bg-accent-dark'
            : 'border border-slate-300 dark:border-slate-700 text-ink dark:text-slate-100 hover:border-slate-400'
        }`}
      >
        Start free trial
      </Link>
      <p className="mt-2 text-xs text-muted text-center">Cancel in 2 clicks · No long-term contract</p>
    </div>
  );
}

function Row({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: ReactNode;
  tooltip?: string;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted shrink-0">{label}</span>
      <span
        className="text-right text-ink dark:text-slate-100"
        {...(tooltip ? { title: tooltip } : {})}
      >
        {value}
      </span>
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }): JSX.Element {
  return (
    <li className="flex items-start gap-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-emerald-600 mt-1 shrink-0"
        aria-hidden="true"
      >
        <path d="m5 12 5 5L20 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
