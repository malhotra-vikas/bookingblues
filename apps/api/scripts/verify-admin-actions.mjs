import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * §8 admin-action verifier. Run BEFORE and AFTER each admin action in /admin to
 * confirm its effect landed (subscription_status, Twilio number, conversations,
 * audit_log). Read-only — never mutates.
 *
 *   node scripts/verify-admin-actions.mjs                       # default +2
 *   node scripts/verify-admin-actions.mjs malhotra.vikas+2@gmail.com
 *   node scripts/verify-admin-actions.mjs <operator-uuid>
 *
 * Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY from env
 * (same .env the API uses). Points at whatever DB the env targets (prod).
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!url || !key || !stripeKey) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / STRIPE_SECRET_KEY');
  process.exit(1);
}

const arg = process.argv[2] ?? 'malhotra.vikas+2@gmail.com';
const db = createClient(url, key, { auth: { persistSession: false } });
const stripe = new Stripe(stripeKey);
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(arg);

async function resolveOperator() {
  if (isUuid) {
    const { data } = await db.from('operators').select('*').eq('id', arg).maybeSingle();
    return data;
  }
  // email → auth user → operator
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const u = (users?.users ?? []).find((x) => x.email === arg);
  if (!u) return null;
  const { data } = await db.from('operators').select('*').eq('user_id', u.id).maybeSingle();
  return data;
}

const op = await resolveOperator();
if (!op) {
  console.error(`No operator found for "${arg}"`);
  process.exit(1);
}

console.log(`\n=== Operator: ${op.business_name} (${op.id}) ===`);
console.log(`  subscription_status : ${op.subscription_status}`);
console.log(`  plan / cadence      : ${op.plan ?? '—'} / ${op.plan_cadence ?? '—'}`);
console.log(`  stripe_subscription : ${op.stripe_subscription_id ?? '—'}`);
console.log(`  twilio_number       : ${op.twilio_number_e164 ?? '—'} (sid ${op.twilio_number_sid ?? '—'})`);

// Stripe side — does the DB match Stripe? (handles a deleted sub gracefully)
if (op.stripe_subscription_id) {
  try {
    const sub = await stripe.subscriptions.retrieve(op.stripe_subscription_id);
    console.log(`  stripe live status  : ${sub.status}${sub.cancel_at_period_end ? ' (cancel_at_period_end)' : ''}`);
  } catch (e) {
    console.log(`  stripe live status  : ⚠ ${e.message}`);
  }
}

// Conversation status tally (Deactivate should close active/awaiting/escalated).
const { data: convos } = await db
  .from('conversations')
  .select('status')
  .eq('operator_id', op.id);
const tally = {};
for (const c of convos ?? []) tally[c.status] = (tally[c.status] ?? 0) + 1;
console.log(`  conversations       : ${Object.entries(tally).map(([s, n]) => `${s}=${n}`).join(', ') || 'none'}`);

// Last 10 audit_log rows for this operator (the action you just ran should be on top).
const { data: audit } = await db
  .from('audit_log')
  .select('action, created_at, actor_user_id, metadata')
  .eq('operator_id', op.id)
  .order('created_at', { ascending: false })
  .limit(10);
console.log(`\n  recent audit_log:`);
for (const a of audit ?? []) {
  const meta = a.metadata ? JSON.stringify(a.metadata).slice(0, 90) : '';
  console.log(`    ${a.created_at}  ${a.action}  ${meta}`);
}
if (!audit || audit.length === 0) console.log('    (none)');
console.log('');
