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
 */

export type DepositMode = 'off-by-default' | 'on-by-default' | 'mandatory';

interface PlanPolicy {
  /** Platform take rate in basis points (10% = 1000), charged on top of deposit. */
  readonly takeRateBps: number;
  readonly depositMode: DepositMode;
}

const PLAN_POLICY: Record<'solo' | 'crew' | 'fleet', PlanPolicy> = {
  solo: { takeRateBps: 1000, depositMode: 'off-by-default' },
  crew: { takeRateBps: 1500, depositMode: 'on-by-default' },
  fleet: { takeRateBps: 2000, depositMode: 'mandatory' },
};

/**
 * Platform take-rate (bps) for a stored `operators.plan` slug, charged on top of
 * the deposit. Returns null for unknown/legacy/null plans so the caller can fall
 * back to the env default (`PLATFORM_TAKE_RATE_BPS`).
 */
export function platformTakeRateBpsForPlan(plan: string | null | undefined): number | null {
  if (plan === 'solo' || plan === 'crew' || plan === 'fleet') {
    return PLAN_POLICY[plan].takeRateBps;
  }
  return null;
}

/** Deposit mode for a plan slug, or null for unknown/legacy/null plans. */
export function depositModeForPlan(plan: string | null | undefined): DepositMode | null {
  if (plan === 'solo' || plan === 'crew' || plan === 'fleet') {
    return PLAN_POLICY[plan].depositMode;
  }
  return null;
}
