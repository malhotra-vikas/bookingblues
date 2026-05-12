import Link from 'next/link';

import { TrialBanner } from '../../../components/TrialBanner';
import { ApiError, apiAsUser } from '../../../lib/api';

interface Metrics {
  conversations: { total: number; booked: number; out_of_scope: number; escalated: number; active: number };
  appointments: { total: number; confirmed: number; completed: number; cancelled: number };
  fee_revenue_cents: number;
  subscription_status: string | null;
  trial_ends_at: string | null;
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
  caller_email: string | null;
  job_summary: string;
  scheduled_for_start: string;
  scheduled_for_end: string;
  status: string;
  fee_status: string;
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function formatE164(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
function maskPhone(e164: string): string {
  return `•••${e164.slice(-4)}`;
}
function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}
function formatAppointmentTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

  const hasMetrics = !('error' in metricsR);

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          {hasMetrics && (
            <p className="text-xs text-muted mt-1">
              Stats for {new Date(metricsR.month_start_iso).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
        {hasMetrics ? (
          <TrialBanner
            status={metricsR.subscription_status}
            trialEndsAt={metricsR.trial_ends_at}
          />
        ) : null}
      </header>

      {'error' in metricsR ? (
        <p className="text-sm text-red-600">Couldn&apos;t load metrics: {metricsR.error}</p>
      ) : (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label="Conversations"
            value={metricsR.conversations.total}
            sublabel={`${metricsR.conversations.active} active · ${metricsR.conversations.escalated} escalated`}
            tone="default"
          />
          <Stat
            label="Booked"
            value={metricsR.conversations.booked}
            sublabel={metricsR.conversations.total > 0
              ? `${Math.round((metricsR.conversations.booked / metricsR.conversations.total) * 100)}% conversion`
              : 'no conversions yet'}
            tone="success"
          />
          <Stat
            label="Appointments"
            value={metricsR.appointments.total}
            sublabel={`${metricsR.appointments.confirmed} confirmed · ${metricsR.appointments.completed} done`}
            tone="info"
          />
          <Stat
            label="Fees collected"
            value={formatDollars(metricsR.fee_revenue_cents)}
            sublabel={metricsR.fee_revenue_cents === 0 ? 'enable in settings' : 'this month'}
            tone="accent"
          />
        </section>
      )}

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent conversations</h2>
          {hasMetrics && metricsR.conversations.escalated > 0 && (
            <span className="text-xs text-red-700">
              {metricsR.conversations.escalated} need human attention
            </span>
          )}
        </div>
        {'error' in conversationsR ? (
          <p className="text-sm text-red-600">Couldn&apos;t load: {conversationsR.error}</p>
        ) : conversationsR.data.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            body="Your first missed call will show up here. Forward your business line in the last step of onboarding to get going."
            cta={{ href: '/onboarding', label: 'Finish onboarding →' }}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Caller</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Outcome</th>
                  <th className="px-3 py-2 text-left">Last message</th>
                </tr>
              </thead>
              <tbody>
                {conversationsR.data.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono">{maskPhone(c.caller_phone_e164)}</td>
                    <td className="px-3 py-2"><StatusBadge status={c.status} /></td>
                    <td className="px-3 py-2 text-muted">{c.outcome ?? '—'}</td>
                    <td className="px-3 py-2 text-muted whitespace-nowrap">
                      {relativeTime(c.last_message_at)}
                    </td>
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
          <EmptyState
            title="No appointments yet"
            body="Once the AI books a job for you, it will show up here with caller details and a one-tap call link."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Caller</th>
                  <th className="px-3 py-2 text-left">Job</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Fee</th>
                </tr>
              </thead>
              <tbody>
                {appointmentsR.data.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 whitespace-nowrap">{formatAppointmentTime(a.scheduled_for_start)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{a.caller_name}</div>
                      <div className="flex items-center gap-2 text-xs text-muted">
                        <a href={`tel:${a.caller_phone_e164}`} className="text-accent font-mono no-underline hover:underline">
                          {formatE164(a.caller_phone_e164)}
                        </a>
                        {a.caller_email && (
                          <a href={`mailto:${a.caller_email}`} className="text-accent no-underline hover:underline">
                            email
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <div className="truncate">{a.job_summary}</div>
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={a.status} /></td>
                    <td className="px-3 py-2"><FeeBadge status={a.fee_status} /></td>
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
  sublabel,
  tone,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  tone: 'default' | 'success' | 'info' | 'accent';
}): JSX.Element {
  const bar = {
    default: 'bg-slate-300',
    success: 'bg-emerald-500',
    info: 'bg-blue-500',
    accent: 'bg-accent',
  }[tone];
  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-4 overflow-hidden">
      <span className={`absolute top-0 left-0 right-0 h-0.5 ${bar}`} />
      <div className="text-[11px] text-muted uppercase tracking-wide font-medium">{label}</div>
      <div className="text-3xl font-semibold text-ink tracking-tight mt-1">{value}</div>
      {sublabel ? <div className="text-[11px] text-muted mt-1">{sublabel}</div> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const cls: Record<string, string> = {
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    escalated: 'bg-red-50 text-red-700 border-red-200',
    confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
    cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
    awaiting_bot: 'bg-amber-50 text-amber-700 border-amber-200',
    awaiting_caller: 'bg-amber-50 text-amber-700 border-amber-200',
    active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    abandoned: 'bg-slate-100 text-slate-600 border-slate-200',
  };
  const c = cls[status] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${c}`}>
      {status}
    </span>
  );
}

function FeeBadge({ status }: { status: string }): JSX.Element {
  if (status === 'none') return <span className="text-xs text-muted">—</span>;
  const cls: Record<string, string> = {
    paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    refunded: 'bg-slate-100 text-slate-600 border-slate-200',
    expired: 'bg-red-50 text-red-700 border-red-200',
  };
  const c = cls[status] ?? 'bg-slate-100 text-slate-700 border-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${c}`}>
      {status}
    </span>
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}): JSX.Element {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="text-sm text-muted mt-1 max-w-md mx-auto">{body}</p>
      {cta && (
        <Link href={cta.href} className="inline-block mt-4 text-sm text-accent no-underline hover:underline">
          {cta.label}
        </Link>
      )}
    </div>
  );
}
