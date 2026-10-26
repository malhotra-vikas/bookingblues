import Stripe from 'stripe';

/**
 * Create the Founding Member promo coupons (one per plan) in the current Stripe
 * mode. $25 first month → amount_off = planPrice − $25, duration: once,
 * redeem_by = end of the promo. Idempotent-ish: re-running creates NEW coupons
 * (Stripe coupon ids are auto-generated) — run once per environment and copy the
 * printed ids into env. Reads STRIPE_SECRET_KEY.
 *
 *   node scripts/create-founding-coupons.mjs
 *
 * Then set in the API env (same mode as the key):
 *   STRIPE_COUPON_FOUNDING_SOLO / _CREW / _FLEET  = printed ids
 *   PROMO_FOUNDING_ENDS_AT = the printed end date
 */
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Missing STRIPE_SECRET_KEY');
  process.exit(1);
}
const stripe = new Stripe(key);
const live = key.startsWith('sk_live');

// Regular MONTHLY prices in cents. Keep in sync with the live Stripe prices.
const PLANS = [
  { slug: 'SOLO', name: 'Solo', priceCents: 19900 },
  { slug: 'CREW', name: 'Crew', priceCents: 65000 },
  { slug: 'FLEET', name: 'Fleet', priceCents: 149900 },
];
const FIRST_MONTH_CENTS = 2500; // $25
// End of 2027, US Eastern. Stripe can't extend redeem_by on an existing coupon,
// so moving the end date means creating new coupons and repointing env.
const ENDS_AT = '2028-01-01T00:00:00-05:00';
const REDEEM_BY = Math.floor(new Date(ENDS_AT).getTime() / 1000);

console.log(`Stripe mode: ${live ? 'LIVE' : 'TEST'}\n`);

for (const p of PLANS) {
  const amountOff = p.priceCents - FIRST_MONTH_CENTS;
  const coupon = await stripe.coupons.create({
    name: `Founding: ${p.name} $25 first mo`,
    amount_off: amountOff,
    currency: 'usd',
    duration: 'once',
    redeem_by: REDEEM_BY,
    metadata: { promo: 'founding_member', plan: p.slug.toLowerCase() },
  });
  console.log(
    `${p.name}: $${(amountOff / 100).toFixed(2)} off → first month $${(FIRST_MONTH_CENTS / 100).toFixed(2)}`,
  );
  console.log(`  STRIPE_COUPON_FOUNDING_${p.slug}=${coupon.id}\n`);
}
console.log(`PROMO_FOUNDING_ENDS_AT=${ENDS_AT}`);
