import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { StripeService } from '../../common/stripe/stripe.service';
import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { isFoundingPromoActive } from '../billing/founding-promo';

export interface PlanCadencePrice {
  readonly price_id: string;
  /** Amount in cents from Stripe, or null if the price couldn't be resolved. */
  readonly unit_amount_cents: number | null;
  readonly currency: string;
}

export interface PlanPricing {
  readonly slug: 'solo' | 'crew' | 'fleet';
  readonly monthly: PlanCadencePrice | null;
  readonly annual: PlanCadencePrice | null;
}

export interface PromoInfo {
  /** Founding Member promo currently running (monthly plans, $25 first month). */
  readonly founding_active: boolean;
  readonly ends_at: string | null;
  readonly first_month_usd: number;
}

/** Which env price IDs back each plan/cadence. Keys are `keyof Env`. */
const PLAN_PRICE_ENVS = [
  { slug: 'solo', monthly: 'STRIPE_PRICE_SOLO_MONTHLY', annual: 'STRIPE_PRICE_SOLO_ANNUAL' },
  { slug: 'crew', monthly: 'STRIPE_PRICE_CREW_MONTHLY', annual: 'STRIPE_PRICE_CREW_ANNUAL' },
  { slug: 'fleet', monthly: 'STRIPE_PRICE_FLEET_MONTHLY', annual: 'STRIPE_PRICE_FLEET_ANNUAL' },
] as const satisfies ReadonlyArray<{
  slug: PlanPricing['slug'];
  monthly: keyof Env;
  annual: keyof Env;
}>;

const CACHE_TTL_MS = 15 * 60 * 1000; // Prices change rarely; avoid a Stripe call per pageview.

/**
 * Serves the live plan prices from Stripe so the web app never hardcodes them.
 * Reads the configured price IDs (env), resolves their amounts via Stripe, and
 * caches for 15 minutes. Any resolution failure leaves that amount `null` so the
 * web layer can fall back to its static constants — the pricing page must never
 * break because Stripe is slow or unset.
 */
@Injectable()
export class PlansService {
  private cache: { at: number; data: PlanPricing[] } | null = null;

  constructor(
    private readonly stripe: StripeService,
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PlansService.name);
  }

  /** Founding Member promo state for the marketing UI (mirrors the checkout gate). */
  getPromo(): PromoInfo {
    return {
      founding_active: isFoundingPromoActive(this.env),
      ends_at: this.env.PROMO_FOUNDING_ENDS_AT ?? null,
      first_month_usd: 25,
    };
  }

  async getPlans(): Promise<PlanPricing[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.data;

    // Resolve every configured price id once (deduped), tolerating failures.
    const idToPrice = new Map<string, { amount: number | null; currency: string }>();
    const ids = new Set<string>();
    for (const p of PLAN_PRICE_ENVS) {
      const m = this.env[p.monthly];
      const a = this.env[p.annual];
      if (typeof m === 'string' && m) ids.add(m);
      if (typeof a === 'string' && a) ids.add(a);
    }

    await Promise.all(
      [...ids].map(async (id) => {
        try {
          const price = await this.stripe.client().prices.retrieve(id);
          idToPrice.set(id, { amount: price.unit_amount ?? null, currency: price.currency ?? 'usd' });
        } catch (err) {
          this.logger.warn(
            { priceId: id, err: (err as Error).message },
            'plans: stripe price retrieve failed — web will fall back',
          );
          idToPrice.set(id, { amount: null, currency: 'usd' });
        }
      }),
    );

    const cadence = (envKey: keyof Env): PlanCadencePrice | null => {
      const priceId = this.env[envKey];
      if (typeof priceId !== 'string' || !priceId) return null;
      const resolved = idToPrice.get(priceId);
      return {
        price_id: priceId,
        unit_amount_cents: resolved?.amount ?? null,
        currency: resolved?.currency ?? 'usd',
      };
    };

    const data: PlanPricing[] = PLAN_PRICE_ENVS.map((p) => ({
      slug: p.slug,
      monthly: cadence(p.monthly),
      annual: cadence(p.annual),
    }));

    this.cache = { at: Date.now(), data };
    return data;
  }
}
