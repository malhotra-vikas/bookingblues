import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * One-time migration for operators whose Stripe subscription is still on a
 * retired price (the pre-rename "BookingBlues Starter"/"Pro" plans) that no
 * current `STRIPE_PRICE_*` env var maps to. Those subscriptions resolve to a
 * null `plan`, so the usage meter has no limit to show. We swap each one to the
 * equivalent current price; afterwards re-run backfill-operator-plans.mjs to
 * populate plan/cadence from the new price.
 *
 *   node scripts/migrate-legacy-subscriptions.mjs            # dry-run (default)
 *   node scripts/migrate-legacy-subscriptions.mjs --apply    # write changes
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, and the six
 * STRIPE_PRICE_* vars (same .env the API uses).
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!url || !key || !stripeKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

// Current prices we sell, keyed by env var.
const SOLO_MONTHLY = process.env.STRIPE_PRICE_SOLO_MONTHLY;
const CREW_MONTHLY = process.env.STRIPE_PRICE_CREW_MONTHLY;
const currentPriceIds = new Set(
  [
    'STRIPE_PRICE_SOLO_MONTHLY',
    'STRIPE_PRICE_SOLO_ANNUAL',
    'STRIPE_PRICE_CREW_MONTHLY',
    'STRIPE_PRICE_CREW_ANNUAL',
    'STRIPE_PRICE_FLEET_MONTHLY',
    'STRIPE_PRICE_FLEET_ANNUAL',
  ]
    .map((k) => process.env[k])
    .filter(Boolean),
);

// Legacy price ID -> current target price ID. Starter ($49/mo) -> Solo monthly
// (same $49/mo, no proration). Pro -> Crew monthly. Add IDs here as discovered.
const LEGACY_MAP = new Map([
  ['price_1TUVwJBrlSqhHprpJGztuOPN', SOLO_MONTHLY], // BookingBlues Starter $49/mo -> Solo monthly
]);

if (!SOLO_MONTHLY || !CREW_MONTHLY) {
  console.error('STRIPE_PRICE_SOLO_MONTHLY / STRIPE_PRICE_CREW_MONTHLY unset — cannot map legacy plans. Aborting.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const stripe = new Stripe(stripeKey);

const { data: ops, error } = await db
  .from('operators')
  .select('id, business_name, stripe_subscription_id')
  .not('stripe_subscription_id', 'is', null)
  .order('created_at', { ascending: true });
if (error) {
  console.error('operators query error:', error.message);
  process.exit(1);
}

console.log(`\n${APPLY ? '🟢 APPLY' : '🔵 DRY-RUN'} — scanning ${ops.length} operator subscription(s)\n`);

let migrated = 0;
for (const o of ops) {
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(o.stripe_subscription_id);
  } catch (e) {
    console.log(`• ${o.business_name}: cannot retrieve ${o.stripe_subscription_id} — ${e.message}  (skip)`);
    continue;
  }

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;

  if (priceId && currentPriceIds.has(priceId)) {
    console.log(`• ${o.business_name}: already on a current price (${priceId}) — skip`);
    continue;
  }

  const target = priceId ? LEGACY_MAP.get(priceId) : null;
  if (!target) {
    console.log(`• ${o.business_name}: price ${priceId} is not in LEGACY_MAP — needs manual review, skip`);
    continue;
  }

  migrated++;
  console.log(`• ${o.business_name}: migrate ${priceId} -> ${target}`);
  if (APPLY) {
    try {
      await stripe.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: target }],
        proration_behavior: 'none',
      });
      console.log('    ✓ subscription updated');
    } catch (e) {
      console.log(`    ✗ update failed: ${e.message}`);
    }
  }
}

console.log(
  `\n${migrated} subscription(s) ${APPLY ? 'migrated' : 'would migrate'}.` +
    (APPLY
      ? '  Now run: node scripts/backfill-operator-plans.mjs --apply'
      : '  Re-run with --apply to write.') +
    '\n',
);
