import type { Metadata } from 'next';

import { PromoteSalesForm } from '../../../../components/admin/PromoteSalesForm';

export const metadata: Metadata = {
  title: 'Sales reps — Admin',
  robots: { index: false, follow: false },
};

export default function AdminSalesPage(): JSX.Element {
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
    </section>
  );
}
