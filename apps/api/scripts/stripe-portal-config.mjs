import Stripe from 'stripe';

/**
 * Check (default) or fix (--apply) the Stripe customer-portal configuration so
 * operators can switch plans themselves. Prod 2026-11-04: the LIVE portal was
 * cancel-only, while the Solo limit emails say "upgrade to Crew".
 *
 *   STRIPE_SECRET_KEY=sk_… node scripts/stripe-portal-config.mjs            # check (exit 1 if wrong)
 *   STRIPE_SECRET_KEY=sk_… node scripts/stripe-portal-config.mjs --apply    # fix the default config
 *
 * Expected: plan switching on, `price` updates only (no quantity), every
 * STRIPE_PRICE_{SOLO,CREW,FLEET}_{MONTHLY,ANNUAL} offered, prorations invoiced
 * immediately (`always_invoice`), billing date unchanged.
 */
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Missing STRIPE_SECRET_KEY');
  process.exit(1);
}
const APPLY = process.argv.includes('--apply');
const stripe = new Stripe(key);
const mode = key.includes('_live_') ? 'LIVE' : 'TEST';

const PRICE_ENVS = ['SOLO', 'CREW', 'FLEET'].flatMap((p) => [`STRIPE_PRICE_${p}_MONTHLY`, `STRIPE_PRICE_${p}_ANNUAL`]);
const priceIds = PRICE_ENVS.map((k) => process.env[k]).filter(Boolean);
if (priceIds.length !== PRICE_ENVS.length) {
  console.error(`Missing price env vars: ${PRICE_ENVS.filter((k) => !process.env[k]).join(', ')}`);
  process.exit(1);
}

// product → its allowed prices
const byProduct = new Map();
for (const id of priceIds) {
  const price = await stripe.prices.retrieve(id);
  const list = byProduct.get(price.product) ?? [];
  list.push(price.id);
  byProduct.set(price.product, list);
}

const configs = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
const config = configs.data[0];
if (!config) {
  console.error(`${mode}: no default customer-portal configuration — create one in the Stripe Dashboard first.`);
  process.exit(1);
}
const full = await stripe.billingPortal.configurations.retrieve(config.id, {
  expand: ['features.subscription_update.products'],
});
const su = full.features.subscription_update;

const problems = [];
if (!su.enabled) problems.push('plan switching is OFF');
if (JSON.stringify(su.default_allowed_updates) !== JSON.stringify(['price'])) {
  problems.push(`allowed updates are ${JSON.stringify(su.default_allowed_updates)} (want ["price"])`);
}
if (su.proration_behavior !== 'always_invoice') problems.push(`proration is ${su.proration_behavior} (want always_invoice)`);
const offered = new Set((su.products ?? []).flatMap((p) => p.prices));
const missing = priceIds.filter((id) => !offered.has(id));
if (missing.length) problems.push(`prices not offered: ${missing.join(', ')}`);
const qty = (su.products ?? []).filter((p) => p.adjustable_quantity?.enabled).map((p) => p.product);
if (qty.length) problems.push(`quantity changes allowed on: ${qty.join(', ')}`);

console.log(`${mode} portal ${full.id}: ${problems.length ? 'NEEDS FIX' : 'OK'}`);
for (const p of problems) console.log(`  - ${p}`);
if (!problems.length) process.exit(0);
if (!APPLY) {
  console.log('Re-run with --apply to fix.');
  process.exit(1);
}

const products = [...byProduct.entries()].map(([product, prices]) => ({
  product,
  prices,
  adjustable_quantity: { enabled: false },
}));
await stripe.billingPortal.configurations.update(full.id, {
  features: {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      proration_behavior: 'always_invoice',
      billing_cycle_anchor: 'unchanged',
      products,
    },
  },
});
console.log(`${mode} portal ${full.id}: fixed (${products.length} products, ${priceIds.length} prices).`);
