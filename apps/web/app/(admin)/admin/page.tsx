import { apiAsUser } from '../../../lib/api';

interface GlobalMetrics {
  operators: { total: number; trialing: number; active: number; past_due: number; canceled: number };
  mrr_cents_approx: number;
  conversations_active_now: number;
  escalations_open: number;
  fee_revenue_mtd_cents: number;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function AdminOverviewPage(): Promise<JSX.Element> {
  const metrics = await apiAsUser<GlobalMetrics>('/v1/admin/metrics').catch(() => null);

  if (!metrics) {
    return (
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted">Couldn't load metrics — try refreshing.</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Overview</h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Operators (total)" value={metrics.operators.total} />
        <Card label="Trialing" value={metrics.operators.trialing} />
        <Card label="Active" value={metrics.operators.active} />
        <Card label="Past due" value={metrics.operators.past_due} tone={metrics.operators.past_due > 0 ? 'warn' : 'neutral'} />
        <Card label="Canceled" value={metrics.operators.canceled} />
        <Card label="Active conversations" value={metrics.conversations_active_now} />
        <Card label="Open escalations" value={metrics.escalations_open} tone={metrics.escalations_open > 0 ? 'warn' : 'neutral'} />
        <Card label="Fee revenue MTD" value={formatMoney(metrics.fee_revenue_mtd_cents)} />
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'warn';
}): JSX.Element {
  const accent = tone === 'warn' ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-paper';
  return (
    <div className={`rounded-lg border ${accent} p-4`}>
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
