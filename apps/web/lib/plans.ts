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

export interface Promo {
  foundingActive: boolean;
  endsAt: string | null;
  firstMonthUsd: number;
}

const PROMO_OFF: Promo = { foundingActive: false, endsAt: null, firstMonthUsd: 25 };

/** Format a whole-dollar amount for prose, e.g. 1499 → "$1,499". */
export function usd(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

/**
 * Founding Member promo state (server-side; from /v1/plans). Off on any error.
 * Fetched fresh per request (`no-store`) — NOT cached at build time — so toggling
 * the promo env on the API takes effect without a web rebuild, and the promo
 * turns off exactly at its end date. (Prices stay cached via getPlanPrices.)
 */
export async function getPromo(): Promise<Promo> {
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/plans`, { cache: 'no-store' });
    if (!res.ok) return PROMO_OFF;
    const { promo } = (await res.json()) as {
      promo?: { founding_active?: boolean; ends_at?: string | null; first_month_usd?: number };
    };
    if (!promo) return PROMO_OFF;
    return {
      foundingActive: Boolean(promo.founding_active),
      endsAt: promo.ends_at ?? null,
      firstMonthUsd: promo.first_month_usd ?? 25,
    };
  } catch {
    return PROMO_OFF;
  }
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
