import type { Metadata } from 'next';

import { PromoteSalesForm } from '../../../../components/admin/PromoteSalesForm';
import { SalesRepCard, type SalesRep } from '../../../../components/admin/SalesRepCard';
import { apiAsUser } from '../../../../lib/api';

export const metadata: Metadata = {
  title: 'Sales reps — Admin',
  robots: { index: false, follow: false },
};

export default async function AdminSalesPage(): Promise<JSX.Element> {
  const resp = await apiAsUser<{ items: SalesRep[] }>('/v1/admin/sales').catch(() => null);
  const reps = resp?.items ?? [];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold dark:text-slate-100">Sales reps</h1>
        <p className="mt-1 text-sm text-muted dark:text-slate-400">
          Promote a user to the sales role and link their Slack ID. Their claimed leads (from
          #bb-leads) appear in their <code>/sales</code> view with a “Login as” button scoped to
          those leads. Release leads selectively below, or remove the role entirely (which leaves
          their claims intact — claims belong to the Slack identity).
        </p>
      </div>

      <PromoteSalesForm />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted dark:text-slate-400">
          Current sales reps ({reps.length})
        </h2>
        {reps.length === 0 ? (
          <p className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-6 text-sm text-muted dark:text-slate-400">
            No sales reps yet. Promote one above.
          </p>
        ) : (
          reps.map((rep) => <SalesRepCard key={rep.user_id} rep={rep} />)
        )}
      </div>
    </section>
  );
}
