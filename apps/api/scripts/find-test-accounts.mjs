import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const mask = (p) => (p ? `•••${String(p).slice(-4)}` : '—');

// Map auth user_id -> email (for login). Paginate to be safe.
const emailById = new Map();
for (let page = 1; page <= 10; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error('listUsers error:', error.message);
    break;
  }
  for (const u of data.users) emailById.set(u.id, u);
  if (data.users.length < 200) break;
}

// Admin accounts (app_metadata.role === 'admin').
const admins = [...emailById.values()].filter(
  (u) => u.app_metadata?.role === 'admin',
);

const { data: ops, error } = await db
  .from('operators')
  .select(
    'id, business_name, category, twilio_number_e164, twilio_number_sid, personal_phone_e164, subscription_status, onboarding_completed_at, timezone, user_id',
  )
  .order('created_at', { ascending: true });
if (error) {
  console.error('operators error:', error.message);
  process.exit(1);
}

const provisioned = ops.filter((o) => o.twilio_number_e164);

console.log(`\n=== OPERATORS WITH A TWILIO NUMBER (${provisioned.length}) — call these to test ===`);
for (const o of provisioned) {
  const u = emailById.get(o.user_id);
  console.log(
    [
      `• ${o.business_name} (${o.category ?? 'no category'})`,
      `    Twilio # (DIAL THIS): ${o.twilio_number_e164}   sid=${o.twilio_number_sid ?? '—'}`,
      `    forwards-from personal #: ${mask(o.personal_phone_e164)}   tz=${o.timezone ?? '—'}`,
      `    subscription: ${o.subscription_status ?? '—'}   onboarded=${o.onboarding_completed_at ? 'yes' : 'NO'}`,
      `    login email: ${u?.email ?? '(no auth user found)'}`,
    ].join('\n'),
  );
}

const noNumber = ops.length - provisioned.length;
console.log(`\n(${noNumber} other operator(s) have no Twilio number provisioned.)`);

console.log(`\n=== ADMIN ACCOUNTS (${admins.length}) ===`);
for (const a of admins) {
  console.log(`• ${a.email}   id=${a.id}   confirmed=${a.email_confirmed_at ? 'yes' : 'no'}`);
}
if (admins.length === 0) {
  console.log('  None found with app_metadata.role = "admin".');
}
console.log('');
