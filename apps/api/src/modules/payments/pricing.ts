/**
 * CLAUDE.md §9.5: application_fee_amount on a Direct Charge cannot exceed
 * `amount - Stripe processing fee` or Stripe rejects the charge. We compute a
 * conservative cap based on Stripe's standard US card pricing (2.9% + 30¢).
 *
 * For very small fees (e.g. $5 booking fee, 10% take rate = 50¢) the floor
 * (`MIN_PLATFORM_FEE_CENTS`, default $1.00) and the processing-fee cap can
 * conflict — we choose to clamp DOWN to fit the cap rather than ever exceed
 * it. The platform earns less on tiny charges; the alternative is rejected
 * charges, which is worse.
 */

const STRIPE_PCT = 0.029;
const STRIPE_FIXED_CENTS = 30;

export interface PricingInput {
  readonly amountCents: number;
  readonly takeRateBps: number;
  readonly minPlatformFeeCents: number;
}

export interface PricingResult {
  readonly applicationFeeCents: number;
  /** True when the cap clamped the requested fee. */
  readonly clampedToCap: boolean;
  /** The Stripe-processing-fee cap we computed for the given amount. */
  readonly capCents: number;
}

export function computeApplicationFee(input: PricingInput): PricingResult {
  if (input.amountCents <= 0) {
    return { applicationFeeCents: 0, clampedToCap: false, capCents: 0 };
  }
  const requested = Math.max(
    Math.floor((input.amountCents * input.takeRateBps) / 10_000),
    input.minPlatformFeeCents,
  );
  const stripeProcessingCents = Math.ceil(input.amountCents * STRIPE_PCT) + STRIPE_FIXED_CENTS;
  const capCents = Math.max(0, input.amountCents - stripeProcessingCents);
  if (requested > capCents) {
    return { applicationFeeCents: capCents, clampedToCap: true, capCents };
  }
  return { applicationFeeCents: requested, clampedToCap: false, capCents };
}
