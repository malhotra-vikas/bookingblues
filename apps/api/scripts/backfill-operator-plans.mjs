import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * One-time backfill for operators whose `plan` / `plan_cadence` /
 * `current_period_*` columns are null because their Stripe subscription predates
 * (or never re-fired since) the usage-metering webhook sync. Re-derives all of
 * them straight from the live Stripe subscription: plan + cadence from the
 * active price ID (source of truth), billing window from the subscription.
 *
 *   node scripts/backfill-operator-plans.mjs            # dry-run (default)
 *   node scripts/backfill-operator-plans.mjs --apply    # write changes
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, and the six
 * STRIPE_PRICE_* vars from the environment (same .env the API uses).
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!url || !key || !stripeKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

// price ID -> {plan, cadence}, mirrors apps/api/src/modules/billing/plan-pricing.ts
const PRICE_MAP = new Map();
for (const [envKey, plan, cadence] of [
  ['STRIPE_PRICE_SOLO_MONTHLY', 'solo', 'monthly'],
  ['STRIPE_PRICE_SOLO_ANNUAL', 'solo', 'annual'],
  ['STRIPE_PRICE_CREW_MONTHLY', 'crew', 'monthly'],
  ['STRIPE_PRICE_CREW_ANNUAL', 'crew', 'annual'],
  ['STRIPE_PRICE_FLEET_MONTHLY', 'fleet', 'monthly'],
  ['STRIPE_PRICE_FLEET_ANNUAL', 'fleet', 'annual'],
]) {
  const id = process.env[envKey];
  if (id) PRICE_MAP.set(id, { plan, cadence });
}
if (PRICE_MAP.size === 0) {
  console.error('No STRIPE_PRICE_* env vars set — cannot map prices to plans. Aborting.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const stripe = new Stripe(stripeKey);
const unixToIso = (u) => (u ? new Date(u * 1000).toISOString() : null);

const { data: ops, error } = await db
  .from('operators')
  .select(
    'id, business_name, stripe_subscription_id, plan, plan_cadence, stripe_price_id, current_period_start, current_period_end',
  )
  .not('stripe_subscription_id', 'is', null)
  .order('created_at', { ascending: true });
if (error) {
  console.error('operators query error:', error.message);
  process.exit(1);
}

console.log(`\n${APPLY ? '🟢 APPLY' : '🔵 DRY-RUN'} — ${ops.length} operator(s) with a Stripe subscription\n`);

let changed = 0;
for (const o of ops) {
  let sub;
  try {
    sub = await stripe.subscriptions.retrieve(o.stripe_subscription_id);
  } catch (e) {
    console.log(`• ${o.business_name}: cannot retrieve ${o.stripe_subscription_id} — ${e.message}`);
    continue;
  }

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const pc = priceId ? PRICE_MAP.get(priceId) : null;
  const patch = {};
  if (pc) {
    if (o.plan !== pc.plan) patch.plan = pc.plan;
    if (o.plan_cadence !== pc.cadence) patch.plan_cadence = pc.cadence;
  }
  if (priceId && o.stripe_price_id !== priceId) patch.stripe_price_id = priceId;
  const cps = unixToIso(sub.current_period_start);
  const cpe = unixToIso(sub.current_period_end);
  if (cps && o.current_period_start !== cps) patch.current_period_start = cps;
  if (cpe && o.current_period_end !== cpe) patch.current_period_end = cpe;

  if (Object.keys(patch).length === 0) {
    console.log(`• ${o.business_name}: up to date (plan=${o.plan ?? '—'}/${o.plan_cadence ?? '—'})`);
    continue;
  }
  changed++;
  const note = pc ? '' : '  ⚠ price not in env map — plan/cadence left unchanged';
  console.log(`• ${o.business_name}: ${JSON.stringify(patch)}${note}`);
  if (APPLY) {
    const { error: upErr } = await db.from('operators').update(patch).eq('id', o.id);
    console.log(upErr ? `    ✗ update failed: ${upErr.message}` : '    ✓ updated');
  }
}

console.log(
  `\n${changed} operator(s) ${APPLY ? 'updated' : 'would change'}.` +
    (APPLY ? '' : '  Re-run with --apply to write.') +
    '\n',
);
