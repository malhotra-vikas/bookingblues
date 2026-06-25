import type { Metadata } from 'next';

import { PromoteSalesForm } from '../../../../components/admin/PromoteSalesForm';
import { apiAsUser } from '../../../../lib/api';

export const metadata: Metadata = {
  title: 'Sales reps — Admin',
  robots: { index: false, follow: false },
};

interface SalesRep {
  user_id: string;
  email: string | null;
  slack_user_id: string;
  slack_username: string | null;
  linked_at: string;
}

export default async function AdminSalesPage(): Promise<JSX.Element> {
  const resp = await apiAsUser<{ items: SalesRep[] }>('/v1/admin/sales').catch(() => null);
  const reps = resp?.items ?? [];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold dark:text-slate-100">Sales reps</h1>
        <p className="mt-1 text-sm text-muted dark:text-slate-400">
          Promote a user to the sales role and link their Slack ID. Their claimed leads (from
          #bb-leads) then appear in their <code>/sales</code> view with a “Login as” button scoped to
          those leads.
        </p>
      </div>

      <PromoteSalesForm />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted dark:text-slate-400">
          Current sales reps ({reps.length})
        </h2>
        {reps.length === 0 ? (
          <p className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-6 text-sm text-muted dark:text-slate-400">
            No sales reps yet. Promote one above.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-left text-xs uppercase tracking-wide text-muted dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Slack ID</th>
                  <th className="px-4 py-2 font-medium">Slack username</th>
                  <th className="px-4 py-2 font-medium">Linked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {reps.map((rep) => (
                  <tr key={rep.user_id}>
                    <td className="px-4 py-3 text-ink dark:text-slate-100">{rep.email ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted dark:text-slate-400">
                      {rep.slack_user_id}
                    </td>
                    <td className="px-4 py-3 text-muted dark:text-slate-400">
                      {rep.slack_username ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-muted dark:text-slate-400">
                      {new Date(rep.linked_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
