import Link from 'next/link';

import { apiAsUser } from '../../../../lib/api';

interface OperatorListItem {
  id: string;
  business_name: string;
  user_email: string | null;
  category: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  twilio_number_e164: string | null;
  google_calendar_connected: boolean;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  created_at: string;
}

interface ListResp {
  items: OperatorListItem[];
  next_cursor: string | null;
}

interface SearchParams {
  q?: string;
  status?: string;
  cursor?: string;
}

export default async function OperatorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const sp = await searchParams;
  const params = new URLSearchParams();
  if (sp.q) params.set('q', sp.q);
  if (sp.status) params.set('status', sp.status);
  if (sp.cursor) params.set('cursor', sp.cursor);
  const path = `/v1/admin/operators${params.size > 0 ? `?${params.toString()}` : ''}`;
  const resp = await apiAsUser<ListResp>(path).catch(() => null);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold dark:text-slate-100">Operators</h1>
        <span className="text-xs text-muted dark:text-slate-400">{resp?.items.length ?? 0} shown</span>
      </div>

      <form className="flex flex-wrap items-center gap-2" method="GET">
        <input
          type="text"
          name="q"
          placeholder="Search business name…"
          defaultValue={sp.q ?? ''}
          className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ''}
          className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-accent focus:outline-none"
        >
          <option value="">Any status</option>
          <option value="trialing">trialing</option>
          <option value="active">active</option>
          <option value="past_due">past_due</option>
          <option value="canceled">canceled</option>
          <option value="incomplete">incomplete</option>
          <option value="incomplete_expired">incomplete_expired</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark"
        >
          Filter
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase tracking-wide text-muted dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Twilio Number</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Calendar Connected</th>
              <th className="px-3 py-2">Stripe Connect</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody className="dark:text-slate-200">
            {(resp?.items ?? []).map((op) => (
              <tr key={op.id} className="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/admin/operators/${op.id}`} className="text-accent dark:text-accent-light no-underline hover:underline">
                    {op.business_name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted dark:text-slate-400">{op.category ?? '—'}</td>
                <td className="px-3 py-2">{op.subscription_status ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-xs">{op.twilio_number_e164 ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{op.user_email ?? '—'}</td>
                <td className="px-3 py-2">{op.google_calendar_connected ? '✓' : '—'}</td>
                <td className="px-3 py-2">
                  {op.stripe_connect_charges_enabled && op.stripe_connect_payouts_enabled
                    ? '✓'
                    : '—'}
                </td>
                <td className="px-3 py-2 text-muted dark:text-slate-400">
                  {new Date(op.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {(resp?.items.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted dark:text-slate-400">
                  No operators match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {resp?.next_cursor ? (
        <div className="flex justify-end">
          <Link
            href={{ pathname: '/admin/operators', query: { ...sp, cursor: resp.next_cursor } }}
            className="text-sm text-accent dark:text-accent-light no-underline hover:underline"
          >
            Next →
          </Link>
        </div>
      ) : null}
    </section>
  );
}
