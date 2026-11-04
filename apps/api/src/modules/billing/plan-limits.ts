/**
 * Plan usage limits (#usage-metering). The unit is a UNIQUE PERSON (caller phone
 * number) the AI talks to in a monthly usage window — see modules/usage. Mirrors
 * the public plan copy in apps/web/lib/brand.ts (Solo 80 / Crew 500 / Fleet
 * 1500) and the overage terms in the FAQ + Terms §3e — keep them in sync.
 */
export const PLAN_CONVERSATION_LIMITS = {
  solo: 80,
  crew: 500,
  fleet: 1500,
} as const;

/**
 * What happens past the limit: Solo stops engaging NEW people until the operator
 * upgrades or the window resets; Crew/Fleet keep going and pay overage.
 */
export type OverLimitPolicy = 'block' | 'overage';

const OVER_LIMIT_POLICY: Record<keyof typeof PLAN_CONVERSATION_LIMITS, OverLimitPolicy> = {
  solo: 'block',
  crew: 'overage',
  fleet: 'overage',
};

/**
 * Overage pricing: $100 per started batch of 50 extra people (FAQ, Terms §3e) —
 * $2.00/person, deliberately above Crew's ($1.30) and Fleet's ($1.00) included
 * per-person price so overage never beats paying for the plan.
 */
export const OVERAGE_BATCH_SIZE = 50;
export const OVERAGE_BATCH_CENTS = 10_000;

/** Limit for a stored `operators.plan` slug, or null when unknown (legacy/no plan). */
export function conversationLimitForPlan(plan: string | null | undefined): number | null {
  if (plan === 'solo' || plan === 'crew' || plan === 'fleet') {
    return PLAN_CONVERSATION_LIMITS[plan];
  }
  return null;
}

/** Over-limit policy for a stored plan slug, or null when unknown (no enforcement). */
export function overLimitPolicyForPlan(plan: string | null | undefined): OverLimitPolicy | null {
  if (plan === 'solo' || plan === 'crew' || plan === 'fleet') return OVER_LIMIT_POLICY[plan];
  return null;
}

/**
 * Free-trial cap: at most 30 people on ANY plan while a Stripe trial runs, and
 * it blocks (no overage — trial usage is never billed). The operator lifts it by
 * ending the trial early (TrialBanner → POST /v1/billing/end-trial), which starts
 * the paid period and a fresh window at the full plan limit.
 */
export const TRIAL_PEOPLE_LIMIT = 30;

export interface UsageLimits {
  readonly limit: number | null;
  readonly policy: OverLimitPolicy | null;
  /** True while the trial cap (not the plan limit) applies. */
  readonly trial: boolean;
}

/**
 * The limit in force for an operator. A trial is a STRIPE trial (trialing with a
 * subscription id); comped / sales-rep accounts are `trialing` with no Stripe
 * subscription and keep their plan's rules (none, when they have no plan).
 */
export function usageLimitsFor(op: {
  readonly plan: string | null;
  readonly subscription_status: string | null;
  readonly stripe_subscription_id: string | null;
}): UsageLimits {
  if (op.subscription_status === 'trialing' && op.stripe_subscription_id) {
    return { limit: TRIAL_PEOPLE_LIMIT, policy: 'block', trial: true };
  }
  return {
    limit: conversationLimitForPlan(op.plan),
    policy: overLimitPolicyForPlan(op.plan),
    trial: false,
  };
}

export interface Overage {
  readonly extraPeople: number;
  readonly batches: number;
  readonly amountCents: number;
}

/** Overage owed for `used` people against `limit`. Zero when at or under the limit. */
export function overageFor(used: number, limit: number): Overage {
  const extraPeople = Math.max(0, used - limit);
  const batches = Math.ceil(extraPeople / OVERAGE_BATCH_SIZE);
  return { extraPeople, batches, amountCents: batches * OVERAGE_BATCH_CENTS };
}

/** Alert thresholds crossed at `used` of `limit` (each fires once per window). */
export const USAGE_ALERT_THRESHOLDS = [80, 100] as const;
export type UsageAlertThreshold = (typeof USAGE_ALERT_THRESHOLDS)[number];

export function thresholdsReached(used: number, limit: number): UsageAlertThreshold[] {
  if (limit <= 0) return [];
  return USAGE_ALERT_THRESHOLDS.filter((pct) => used >= Math.ceil((limit * pct) / 100));
}
