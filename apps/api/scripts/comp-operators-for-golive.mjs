import { createClient } from '@supabase/supabase-js';

/**
 * Cutover companion: comp every existing operator onto a long trial and clear
 * their dead TEST-mode Stripe linkage.
 *
 * Why this exists: Stripe test and live are hard-isolated. A test-mode
 * `cus_…` / `sub_…` / `acct_…` simply does not resolve against live keys, so
 * after the cutover every Stripe call for these rows would throw "no such
 * customer". Nobody was ever charged real money (test cards), so rather than
 * stranding the accounts we null the linkage and grant a comp trial —
 * `subscription_status='trialing'` with no Stripe object at all, which is an
 * already-supported state in this codebase (see sales.service.ts, which creates
 * rep-originated operators exactly this way).
 *
 * What it writes per operator:
 *   subscription_status        -> 'trialing'
 *   trial_ends_at              -> --until (default 180 days out)
 *   plan / plan_cadence        -> preserved if set, else --plan / 'monthly'
 *   stripe_customer_id         -> null
 *   stripe_subscription_id     -> null
 *   stripe_price_id            -> null
 *   stripe_connect_account_id  -> null
 *   stripe_connect_charges_enabled / _payouts_enabled -> false
 *   current_period_start / _end -> null  (usage meter falls back to calendar
 *                                         month, which is right for a comp —
 *                                         a 180-day "period" would break the
 *                                         per-month conversation limit)
 *
 * Connect note: nulling stripe_connect_account_id means any operator who wants
 * to collect deposits must re-run Connect Express onboarding in live (real KYC,
 * not the 000-00-0000 test SSN). That is unavoidable — test acct_… IDs do not
 * exist in live.
 *
 *   node scripts/comp-operators-for-golive.mjs                    # dry-run
 *   node scripts/comp-operators-for-golive.mjs --apply
 *   node scripts/comp-operators-for-golive.mjs --apply --until 2027-02-08 --plan solo
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const DEFAULT_UNTIL = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10);
const UNTIL = argOf('--until', DEFAULT_UNTIL);
const DEFAULT_PLAN = argOf('--plan', 'solo');

if (!/^\d{4}-\d{2}-\d{2}$/.test(UNTIL)) {
  console.error(`--until must be YYYY-MM-DD, got "${UNTIL}"`);
  process.exit(1);
}
if (!['solo', 'crew', 'fleet'].includes(DEFAULT_PLAN)) {
  console.error(`--plan must be solo|crew|fleet, got "${DEFAULT_PLAN}"`);
  process.exit(1);
}
const trialEndsAt = new Date(`${UNTIL}T23:59:59Z`).toISOString();

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: ops, error } = await db
  .from('operators')
  .select(
    'id,business_name,subscription_status,plan,plan_cadence,stripe_customer_id,stripe_subscription_id,stripe_price_id,stripe_connect_account_id,stripe_connect_charges_enabled,stripe_connect_payouts_enabled,trial_ends_at,created_at',
  )
  .order('created_at', { ascending: true });

if (error) {
  console.error('query failed:', error.message);
  process.exit(1);
}

console.log(`Mode         : ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`);
console.log(`Comp until   : ${UNTIL} (${trialEndsAt})`);
console.log(`Default plan : ${DEFAULT_PLAN} (existing plan preserved where set)`);
console.log(`Operators    : ${ops.length}\n`);

let changed = 0;
let failed = 0;

for (const o of ops) {
  const clearing = [
    o.stripe_customer_id ? 'cus' : null,
    o.stripe_subscription_id ? 'sub' : null,
    o.stripe_price_id ? 'price' : null,
    o.stripe_connect_account_id ? 'connect' : null,
  ].filter(Boolean);

  const patch = {
    subscription_status: 'trialing',
    trial_ends_at: trialEndsAt,
    plan: o.plan ?? DEFAULT_PLAN,
    plan_cadence: o.plan_cadence ?? 'monthly',
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    stripe_connect_account_id: null,
    stripe_connect_charges_enabled: false,
    stripe_connect_payouts_enabled: false,
    current_period_start: null,
    current_period_end: null,
  };

  const label = `${(o.business_name ?? '?').slice(0, 28).padEnd(28)}`;
  const detail = `${String(o.subscription_status).padEnd(8)} -> trialing | plan ${String(o.plan).padEnd(5)} -> ${patch.plan.padEnd(5)} | clearing: ${clearing.length ? clearing.join('+') : 'none'}`;

  if (!APPLY) {
    console.log(`[dry-run] ${label} ${detail}`);
    changed++;
    continue;
  }

  const { error: upErr } = await db.from('operators').update(patch).eq('id', o.id);
  if (upErr) {
    console.error(`FAILED    ${label} ${upErr.message}`);
    failed++;
  } else {
    console.log(`updated   ${label} ${detail}`);
    changed++;
  }
}

console.log(`\n${APPLY ? 'Updated' : 'Would update'}: ${changed}${failed ? `  FAILED: ${failed}` : ''}`);
if (!APPLY) console.log('Dry run only — nothing was written. Re-run with --apply.');
if (failed) process.exit(1);
