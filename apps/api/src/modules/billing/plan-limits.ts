/**
 * Conversations included per billing cycle, by plan (#usage-metering). Mirrors
 * the public plan copy in apps/web/lib/brand.ts (Solo 80 / Crew 500 / Fleet
 * 1500) — keep the two in sync. Used for the dashboard usage display; plan-cap
 * enforcement/overage is a separate follow-up.
 */
export const PLAN_CONVERSATION_LIMITS = {
  solo: 80,
  crew: 500,
  fleet: 1500,
} as const;

/** Limit for a stored `operators.plan` slug, or null when unknown (legacy/no plan). */
export function conversationLimitForPlan(plan: string | null | undefined): number | null {
  if (plan === 'solo' || plan === 'crew' || plan === 'fleet') {
    return PLAN_CONVERSATION_LIMITS[plan];
  }
  return null;
}
