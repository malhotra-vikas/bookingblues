'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import { Reveal } from '../../../components/Reveal';
import { PLANS, depositLabel, type Plan, type PlanSlug } from '../../../lib/brand';
import { type PlanPrices, type Promo } from '../../../lib/plans';

type Cadence = 'monthly' | 'annual';

export function PricingTiers({
  prices,
  promo,
}: {
  prices: Record<PlanSlug, PlanPrices>;
  promo: Promo;
}): JSX.Element {
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

      <div className="mt-8 grid gap-5 lg:grid-cols-3 items-stretch">
        {PLANS.map((plan, i) => (
          <Reveal key={plan.slug} delay={i * 110} className="h-full">
            <TierCard plan={plan} cadence={cadence} price={prices[plan.slug]} promo={promo} />
          </Reveal>
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
      className={`rounded-full px-4 py-1.5 transition-all duration-300 ${
        active
          ? 'bg-brand-sheen text-white shadow-glow'
          : 'text-muted hover:text-ink dark:hover:text-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function TierCard({
  plan,
  cadence,
  price,
  promo,
}: {
  plan: Plan;
  cadence: Cadence;
  price?: PlanPrices;
  promo: Promo;
}): JSX.Element {
  // Live Stripe prices (via /v1/plans); fall back to the brand.ts constants.
  const monthlyUsd = price?.monthlyUsd ?? plan.monthlyPriceUsd;
  const annualUsd = price?.annualUsd ?? plan.annualPriceUsd;
  const monthlyEquivalent =
    cadence === 'annual' ? Math.round((annualUsd / 12) * 100) / 100 : monthlyUsd;
  const annualSavings = monthlyUsd * 12 - annualUsd;
  const recommended = plan.recommended;
  // Founding Member: $25 first month, monthly only.
  const showFounding = promo.foundingActive && cadence === 'monthly';

  return (
    <div
      className={`card-lift relative h-full rounded-2xl bg-white dark:bg-slate-900 p-6 flex flex-col shadow-card ${
        recommended ? 'ring-2 ring-accent/50 shadow-glow' : 'border border-slate-200/70 dark:border-slate-800'
      }`}
    >
      {recommended ? (
        <>
          <div aria-hidden className="absolute inset-x-0 top-0 h-1.5 rounded-t-2xl bg-brand-sheen" />
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-block rounded-full bg-brand-sheen text-white text-[11px] font-semibold tracking-wide uppercase px-3 py-1 shadow-glow">
            Most popular
          </span>
        </>
      ) : null}

      <div className="font-display text-sm uppercase tracking-wide text-accent">{plan.name}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className={`font-display text-4xl font-bold tracking-tight ${
            recommended ? 'text-gradient' : 'text-ink dark:text-slate-100'
          }`}
        >
          ${cadence === 'annual' ? monthlyEquivalent.toLocaleString() : monthlyUsd.toLocaleString()}
        </span>
        <span className="text-base text-muted">/mo</span>
      </div>
      {showFounding ? (
        <p className="mt-1 inline-flex w-fit items-center rounded-full bg-emerald-100 dark:bg-emerald-900 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          🚀 ${promo.firstMonthUsd} your first month
        </p>
      ) : null}
      {cadence === 'annual' ? (
        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
          ${annualUsd.toLocaleString()}/yr — save ${annualSavings.toLocaleString()}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">
          Prefer annual? ${annualUsd.toLocaleString()}/yr — 2 months free vs. monthly
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
        className={`mt-6 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-base font-semibold no-underline transition-all duration-300 hover:-translate-y-0.5 ${
          recommended
            ? 'bg-brand-sheen text-white shadow-glow hover:shadow-card-hover'
            : 'border border-slate-300 dark:border-slate-700 text-ink dark:text-slate-100 hover:border-accent/40 hover:bg-accent-soft'
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
        className="text-accent mt-1 shrink-0"
        aria-hidden="true"
      >
        <path d="m5 12 5 5L20 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}
