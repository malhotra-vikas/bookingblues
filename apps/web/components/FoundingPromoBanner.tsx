import type { Promo } from '../lib/plans';

/** Formats the promo end date like "Sept 30". Null-safe. */
function endLabel(endsAt: string | null): string {
  if (!endsAt) return '';
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return '';
  // The end is an exclusive instant (e.g. Oct 1 00:00) — show the last full day.
  const last = new Date(d.getTime() - 24 * 3600_000);
  return last.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

/**
 * Founding Member promo banner. Renders only while the promo is active (driven
 * by /v1/plans → promo). Place near the top of marketing/signup pages.
 */
export function FoundingPromoBanner({ promo, className }: { promo: Promo; className?: string }): JSX.Element | null {
  if (!promo.foundingActive) return null;
  const ends = endLabel(promo.endsAt);
  return (
    <div
      className={`rounded-xl bg-brand-sheen text-white px-4 py-3 text-center text-sm font-medium shadow-glow ${className ?? ''}`}
    >
      🚀 <strong>Founding Member offer:</strong> just{' '}
      <strong>${promo.firstMonthUsd} your first month</strong> on any monthly plan — after your 7-day
      free trial.{ends ? ` Ends ${ends}.` : ''}
    </div>
  );
}
