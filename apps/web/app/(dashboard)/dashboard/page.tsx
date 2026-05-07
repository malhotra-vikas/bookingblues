import Link from 'next/link';

import { ApiError, apiAsUser } from '../../../lib/api';

interface Metrics {
  conversations: { total: number; booked: number; out_of_scope: number; escalated: number; active: number };
  appointments: { total: number; confirmed: number; completed: number; cancelled: number };
  fee_revenue_cents: number;
  subscription_status: string | null;
  month_start_iso: string;
}
interface Conversation {
  id: string;
  caller_phone_e164: string;
  status: string;
  outcome: string | null;
  last_message_at: string | null;
  started_at: string;
}
interface Appointment {
  id: string;
  caller_name: string;
  caller_phone_e164: string;
  job_summary: string;
  scheduled_for_start: string;
  scheduled_for_end: string;
  status: string;
  fee_status: string;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}
function maskPhone(e164: string): string {
  return `…${e164.slice(-4)}`;
}

async function safeFetch<T>(path: string): Promise<T | { error: string }> {
  try {
    const r = await apiAsUser<T>(path);
    if (r === null) return { error: 'not_authenticated' };
    return r;
  } catch (err) {
    if (err instanceof ApiError) return { error: err.message };
    return { error: 'unexpected' };
  }
}

export default async function DashboardPage(): Promise<JSX.Element> {
  const [metricsR, conversationsR, appointmentsR] = await Promise.all([
    safeFetch<Metrics>('/v1/dashboard/metrics'),
    safeFetch<{ data: Conversation[] }>('/v1/conversations'),
    safeFetch<{ data: Appointment[] }>('/v1/appointments'),
  ]);

  // Operator row may not exist yet (new signup).
  const noOperator =
    'error' in metricsR &&
    (metricsR.error.toLowerCase().includes('operator') || metricsR.error === 'Operator not found');

  if (noOperator) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Welcome to BookingBlues</h1>
        <p className="text-muted">You haven&apos;t finished setup yet.</p>
        <Link
          href="/onboarding"
          className="inline-block rounded-md bg-accent px-4 py-2 text-white no-underline"
        >
          Start onboarding →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        {'subscription_status' in metricsR && metricsR.subscription_status ? (
          <span className="text-sm text-muted">
            Plan status:{' '}
            <span className="font-medium text-ink">{metricsR.subscription_status}</span>
          </span>
        ) : null}
      </header>

      {'error' in metricsR ? (
        <p className="text-sm text-red-600">Couldn&apos;t load metrics: {metricsR.error}</p>
      ) : (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Conversations" value={metricsR.conversations.total} hint="this month" />
          <Stat label="Booked" value={metricsR.conversations.booked} />
          <Stat label="Appointments" value={metricsR.appointments.total} />
          <Stat label="Fees collected" value={formatDollars(metricsR.fee_revenue_cents)} />
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent conversations</h2>
        {'error' in conversationsR ? (
          <p className="text-sm text-red-600">Couldn&apos;t load: {conversationsR.error}</p>
        ) : conversationsR.data.length === 0 ? (
          <p className="text-sm text-muted">No conversations yet.</p>
        ) : (
          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-2">Caller</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Last message</th>
                </tr>
              </thead>
              <tbody>
                {conversationsR.data.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-3 py-2 font-mono">{maskPhone(c.caller_phone_e164)}</td>
                    <td className="px-3 py-2">{c.status}</td>
                    <td className="px-3 py-2">{c.outcome ?? '—'}</td>
                    <td className="px-3 py-2">{formatTimestamp(c.last_message_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Upcoming appointments</h2>
        {'error' in appointmentsR ? (
          <p className="text-sm text-red-600">Couldn&apos;t load: {appointmentsR.error}</p>
        ) : appointmentsR.data.length === 0 ? (
          <p className="text-sm text-muted">No appointments yet.</p>
        ) : (
          <div className="overflow-x-auto border rounded-md">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Caller</th>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Fee</th>
                </tr>
              </thead>
              <tbody>
                {appointmentsR.data.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="px-3 py-2">{formatTimestamp(a.scheduled_for_start)}</td>
                    <td className="px-3 py-2">
                      {a.caller_name}{' '}
                      <span className="text-muted font-mono">{maskPhone(a.caller_phone_e164)}</span>
                    </td>
                    <td className="px-3 py-2 max-w-xs truncate">{a.job_summary}</td>
                    <td className="px-3 py-2">{a.status}</td>
                    <td className="px-3 py-2">{a.fee_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-md border p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-muted uppercase tracking-wide">{label}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
