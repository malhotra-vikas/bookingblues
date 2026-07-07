import type { Metadata } from 'next';

import { AddLeadForm } from '../../components/sales/AddLeadForm';
import { SalesImpersonateButton } from '../../components/sales/SalesImpersonateButton';
import { apiAsUser } from '../../lib/api';

export const metadata: Metadata = {
  title: 'My leads — KeeprSteady',
  robots: { index: false, follow: false },
};

interface ClaimedLead {
  lead_user_id: string;
  email: string | null;
  operator_id: string | null;
  business_name: string | null;
  category: string | null;
  subscription_status: string | null;
  onboarding_completed_at: string | null;
  claimed_at: string;
}

export default async function SalesLeadsPage(): Promise<JSX.Element> {
  const resp = await apiAsUser<{ data: ClaimedLead[] }>('/v1/sales/leads').catch(() => null);
  const leads = resp?.data ?? [];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">My leads</h1>
        <p className="mt-1 text-sm text-muted">
          Clients you signed or claimed in Slack. Use “Login as” to help a client through
          onboarding — every session is audit-logged.
        </p>
      </div>

      <AddLeadForm />

      {leads.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">No leads yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Your leads show up here when you <strong>add a client</strong> using the form above, or
            when you <strong>claim a lead</strong> in the <span className="font-mono">#bb-leads</span>{' '}
            Slack channel. Newly-signed clients you add are assigned to you automatically.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Business</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Onboarding</th>
                <th className="px-4 py-2 font-medium">Claimed</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.lead_user_id}>
                  <td className="px-4 py-3 text-ink">
                    {lead.business_name ?? <span className="text-muted">—</span>}
                    {lead.category ? (
                      <span className="ml-1 text-xs text-muted">({lead.category})</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted">{lead.email ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">{lead.subscription_status ?? '—'}</td>
                  <td className="px-4 py-3 text-muted">
                    {lead.onboarding_completed_at ? '✓ complete' : 'in progress'}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {new Date(lead.claimed_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {lead.operator_id ? (
                      <SalesImpersonateButton
                        operatorId={lead.operator_id}
                        businessName={lead.business_name ?? lead.email ?? 'this client'}
                      />
                    ) : (
                      <span className="text-xs text-muted">no operator yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
