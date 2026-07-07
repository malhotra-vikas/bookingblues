import { createClient } from '@supabase/supabase-js';

/**
 * Verify (and optionally clean up) a lead a sales rep created via /sales "Add a
 * new client". Read-only unless you pass --delete.
 *
 *   node scripts/verify-sales-lead.mjs <client-email>            # verify
 *   node scripts/verify-sales-lead.mjs <client-email> --delete   # remove test lead
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const email = (process.argv[2] || '').toLowerCase();
const doDelete = process.argv.includes('--delete');
if (!email) {
  console.error('Usage: node scripts/verify-sales-lead.mjs <client-email> [--delete]');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
const info = (m) => console.log(`  ·    ${m}`);

// --- find the client auth user ---
let users = [];
for (let page = 1; ; page++) {
  const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
  users = users.concat(data.users);
  if (data.users.length < 200) break;
}
const u = users.find((x) => (x.email || '').toLowerCase() === email);
if (!u) {
  fail(`no auth user for ${email} — the invite/create did not happen`);
  process.exit(1);
}
pass(`auth user exists (${u.id.slice(0, 8)}, confirmed=${!!u.email_confirmed_at})`);

const meta = u.user_metadata || {};
meta.business_name ? pass(`business_name in metadata: "${meta.business_name}"`) : fail('business_name missing from metadata');
meta.personal_phone_e164
  ? pass(`personal_phone_e164 in metadata: ${meta.personal_phone_e164}`)
  : fail('personal_phone_e164 missing from metadata');

// --- lead_claims: is it tagged to a rep? ---
const { data: claim } = await db
  .from('lead_claims')
  .select('claimed_by_slack_user_id, claimed_by_slack_username, claimed_at')
  .eq('user_id', u.id)
  .maybeSingle();
if (!claim) {
  fail('no lead_claims row — the lead was NOT auto-assigned to a rep');
} else {
  pass(`auto-assigned to ${claim.claimed_by_slack_username || '?'} (${claim.claimed_by_slack_user_id})`);
  // cross-check the rep is a known sales user
  const { data: rep } = await db
    .from('sales_slack_links')
    .select('user_id')
    .eq('slack_user_id', claim.claimed_by_slack_user_id)
    .maybeSingle();
  rep ? pass('assigned rep is a linked sales user') : fail('assigned slack id is not a known sales rep');
}

// --- operator row (created on first login/onboarding, may not exist yet) ---
const { data: op } = await db.from('operators').select('id, business_name').eq('user_id', u.id).maybeSingle();
info(op ? `operator row exists (${op.id.slice(0, 8)}) — client has started onboarding` : 'no operator row yet — client has not logged in / onboarded (expected until they accept the invite)');

if (doDelete) {
  await db.from('lead_claims').delete().eq('user_id', u.id);
  if (op) await db.from('operators').delete().eq('user_id', u.id);
  const { error } = await db.auth.admin.deleteUser(u.id);
  console.log(error ? `\n  cleanup: FAILED ${error.message}` : `\n  cleanup: deleted test lead ${email}`);
}
