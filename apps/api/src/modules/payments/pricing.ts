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

/**
 * @deprecated Superseded by {@link computeBookingFeeCharge}. This computed the
 * platform fee as a cut *taken out of* the deposit (clamped to the Stripe
 * processing cap). The booking-fee model now charges the platform fee *on top*
 * of the deposit (paid by the caller), so this is no longer used in production —
 * retained only for its unit tests and as a reference for the old cap math.
 */
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

export interface BookingFeeChargeInput {
  /** The operator's deposit (what they want to keep), in cents. */
  readonly depositCents: number;
  /** Per-plan platform take rate in bps (10% = 1000). */
  readonly takeRateBps: number;
  readonly minPlatformFeeCents: number;
}

export interface BookingFeeChargeResult {
  /** Total the caller is charged: deposit + platform fee (fee is on top). */
  readonly chargeCents: number;
  /** Direct-Charge `application_fee_amount` — our cut (the platform fee). */
  readonly applicationFeeCents: number;
}

/**
 * Booking-fee charge in the "fee on top, paid by the caller" model
 * (#booking-fee). The caller is charged `deposit + platform fee`; the platform
 * fee becomes the `application_fee_amount` and the operator keeps the full
 * deposit (less Stripe processing, which Direct Charges bill to the connected
 * account). The platform fee floors at `minPlatformFeeCents`.
 *
 * No Stripe-processing cap is needed here (unlike `computeApplicationFee`):
 * because the fee is added on top, `application_fee_amount` is always well
 * below `charge − processing` for any deposit at or above the min fee.
 */
export function computeBookingFeeCharge(input: BookingFeeChargeInput): BookingFeeChargeResult {
  if (input.depositCents <= 0) {
    return { chargeCents: 0, applicationFeeCents: 0 };
  }
  const platformFeeCents = Math.max(
    Math.floor((input.depositCents * input.takeRateBps) / 10_000),
    input.minPlatformFeeCents,
  );
  return {
    chargeCents: input.depositCents + platformFeeCents,
    applicationFeeCents: platformFeeCents,
  };
}
