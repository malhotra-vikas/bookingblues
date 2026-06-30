'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const TABS: Array<{ key: string; label: string }> = [
  { key: 'month', label: 'This month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'year', label: 'This year' },
  { key: 'custom', label: 'Custom' },
];

/** Dashboard stats period selector — drives the `?period=…` query the server
 *  page reads to fetch metrics for the chosen window. */
export function PeriodSelector(): JSX.Element {
  const router = useRouter();
  const params = useSearchParams();
  const active = TABS.some((t) => t.key === params.get('period')) ? params.get('period')! : 'month';
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [to, setTo] = useState(params.get('to') ?? '');

  function select(period: string): void {
    if (period === 'custom') {
      router.push(`/dashboard?period=custom`);
      return;
    }
    router.push(`/dashboard?period=${period}`);
  }

  function applyCustom(): void {
    const qs = new URLSearchParams({ period: 'custom' });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    router.push(`/dashboard?${qs.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => select(t.key)}
            className={`rounded-md px-3 py-1 text-xs font-medium ${
              active === t.key ? 'bg-accent text-white' : 'text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {active === 'custom' ? (
        <div className="inline-flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <button
            type="button"
            onClick={applyCustom}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white"
          >
            Apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
