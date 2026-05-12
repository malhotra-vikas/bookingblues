import { apiAsUser } from '../../../../lib/api';
import { LeadRowActions } from '../../../../components/admin/LeadRowActions';

interface LeadListItem {
  user_id: string;
  email: string | null;
  email_confirmed_at: string | null;
  signed_up_at: string;
  business_name: string | null;
  personal_phone_e164: string | null;
  category: string | null;
  subscription_status: string | null;
  twilio_number_e164: string | null;
  onboarding_completed_at: string | null;
}

interface ListResp {
  items: LeadListItem[];
  next_page: string | null;
}

interface SearchParams {
  page?: string;
}

function formatE164(e164: string | null): string {
  if (!e164) return '—';
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<JSX.Element> {
  const sp = await searchParams;
  const page = sp.page ?? '1';
  const resp = await apiAsUser<ListResp>(`/v1/admin/leads?page=${page}&per_page=50`).catch(() => null);

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">New leads</h1>
          <p className="text-sm text-muted mt-0.5">
            Recent signups — follow up to close + onboard. Mark email verified once they confirm
            out-of-band (verbal, paperwork) so they can sign in.
          </p>
        </div>
        <span className="text-xs text-muted">{resp?.items.length ?? 0} on this page</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Signed up</th>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Onboarding</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(resp?.items ?? []).map((lead) => (
              <tr key={lead.user_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-muted whitespace-nowrap">
                  {new Date(lead.signed_up_at).toLocaleDateString()}{' '}
                  <span className="text-slate-400 text-xs">
                    {new Date(lead.signed_up_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">
                  {lead.business_name ?? <span className="text-muted italic">—</span>}
                  {lead.category ? <div className="text-xs text-muted">{lead.category}</div> : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <a href={`mailto:${lead.email ?? ''}`} className="text-accent no-underline hover:underline">
                      {lead.email ?? '—'}
                    </a>
                    {lead.email_confirmed_at ? (
                      <span title="Email verified" className="text-emerald-600 text-xs">✓</span>
                    ) : (
                      <span title="Email not yet verified" className="text-amber-600 text-xs">●</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {lead.personal_phone_e164 ? (
                    <a href={`tel:${lead.personal_phone_e164}`} className="text-accent no-underline hover:underline">
                      {formatE164(lead.personal_phone_e164)}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">
                  {lead.subscription_status ?? (
                    <span className="text-amber-700 text-xs">not subscribed</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs">
                  {lead.onboarding_completed_at ? (
                    <span className="text-emerald-600">complete</span>
                  ) : lead.twilio_number_e164 ? (
                    <span className="text-amber-700">in progress</span>
                  ) : (
                    <span className="text-slate-500">not started</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <LeadRowActions
                    userId={lead.user_id}
                    email={lead.email}
                    emailVerified={Boolean(lead.email_confirmed_at)}
                  />
                </td>
              </tr>
            ))}
            {(resp?.items.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  No leads yet — newest signups appear here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center">
        {Number(page) > 1 ? (
          <a
            href={`/admin/leads?page=${Number(page) - 1}`}
            className="text-sm text-accent no-underline hover:underline"
          >
            ← Previous
          </a>
        ) : <span />}
        {resp?.next_page ? (
          <a
            href={`/admin/leads?page=${resp.next_page}`}
            className="text-sm text-accent no-underline hover:underline"
          >
            Next →
          </a>
        ) : <span />}
      </div>
    </section>
  );
}
