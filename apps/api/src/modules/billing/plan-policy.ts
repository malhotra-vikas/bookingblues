/**
 * Per-plan booking-deposit policy (#booking-fee). Mirrors the public plan copy
 * in apps/web/lib/brand.ts (PLANS[].platformFeePct + depositMode) — keep the two
 * in sync. Drives both the onboarding deposit step (whether the operator may
 * disable it) and the platform take rate applied to the booking fee.
 *
 * Take rate is charged ON TOP of the operator's deposit and paid by the caller:
 * the caller is charged `deposit + platform fee`, the operator keeps the full
 * deposit (less Stripe card processing), and the platform fee lands on our
 * balance as the Direct-Charge `application_fee_amount`.
 *
 * The bps values below are the *defaults* only. The rate actually applied is
 * env-configurable (PLATFORM_TAKE_RATE_BPS_{SOLO,CREW,FLEET}) and passed in as
 * `overrides` by the caller, so rates can change without a code deploy. Defaults
 * reward scale — bigger plan, smaller cut: Solo 15% > Crew 12% > Fleet 10%.
 */

export type DepositMode = 'off-by-default' | 'on-by-default' | 'mandatory';
export type PlanSlug = 'solo' | 'crew' | 'fleet';

interface PlanPolicy {
  /** Default platform take rate in basis points (15% = 1500), charged on top of deposit. */
  readonly takeRateBps: number;
  readonly depositMode: DepositMode;
}

const PLAN_POLICY: Record<PlanSlug, PlanPolicy> = {
  solo: { takeRateBps: 1500, depositMode: 'off-by-default' },
  crew: { takeRateBps: 1200, depositMode: 'on-by-default' },
  fleet: { takeRateBps: 1000, depositMode: 'mandatory' },
};

function isPlanSlug(plan: string | null | undefined): plan is PlanSlug {
  return plan === 'solo' || plan === 'crew' || plan === 'fleet';
}

/**
 * Platform take-rate (bps) for a stored `operators.plan` slug, charged on top of
 * the deposit. Prefers an env-configured `overrides[plan]` value (including 0),
 * else the compiled default. Returns null for unknown/legacy/null plans so the
 * caller can fall back to the global env default (`PLATFORM_TAKE_RATE_BPS`).
 */
export function platformTakeRateBpsForPlan(
  plan: string | null | undefined,
  overrides?: Partial<Record<PlanSlug, number>>,
): number | null {
  if (isPlanSlug(plan)) {
    return overrides?.[plan] ?? PLAN_POLICY[plan].takeRateBps;
  }
  return null;
}

/** Deposit mode for a plan slug, or null for unknown/legacy/null plans. */
export function depositModeForPlan(plan: string | null | undefined): DepositMode | null {
  if (isPlanSlug(plan)) {
    return PLAN_POLICY[plan].depositMode;
  }
  return null;
}
