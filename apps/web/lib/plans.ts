import { PLANS, type PlanSlug } from './brand';
import { publicEnv } from './env';

interface CadencePrice {
  price_id: string;
  unit_amount_cents: number | null;
  currency: string;
}
interface ApiPlan {
  slug: PlanSlug;
  monthly: CadencePrice | null;
  annual: CadencePrice | null;
}

export interface PlanPrices {
  monthlyUsd: number;
  annualUsd: number;
}

/** Format a whole-dollar amount for prose, e.g. 1499 → "$1,499". */
export function usd(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

/** brand.ts constants as the fallback price map (used if the API/Stripe is down). */
function fallbackPrices(): Record<PlanSlug, PlanPrices> {
  return Object.fromEntries(
    PLANS.map((p) => [p.slug, { monthlyUsd: p.monthlyPriceUsd, annualUsd: p.annualPriceUsd }]),
  ) as Record<PlanSlug, PlanPrices>;
}

/**
 * Live plan prices, sourced from Stripe via the API's `/v1/plans` (which reads
 * the STRIPE_PRICE_* env ids). Server-side only. Falls back to the brand.ts
 * constants for any plan/cadence the API can't resolve, so the pricing UI never
 * breaks. Cached 15 min via Next's fetch cache to match the API-side cache.
 */
export async function getPlanPrices(): Promise<Record<PlanSlug, PlanPrices>> {
  const fallback = fallbackPrices();
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/plans`, {
      next: { revalidate: 900 },
    });
    if (!res.ok) return fallback;
    const { plans } = (await res.json()) as { plans: ApiPlan[] };
    const out = { ...fallback };
    for (const p of plans) {
      const fb = fallback[p.slug];
      if (!fb) continue;
      out[p.slug] = {
        monthlyUsd:
          p.monthly?.unit_amount_cents != null ? p.monthly.unit_amount_cents / 100 : fb.monthlyUsd,
        annualUsd:
          p.annual?.unit_amount_cents != null ? p.annual.unit_amount_cents / 100 : fb.annualUsd,
      };
    }
    return out;
  } catch {
    return fallback;
  }
}
