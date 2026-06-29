import { createClient } from '@supabase/supabase-js';

/**
 * Test helper: end any ACTIVE conversation for a caller so the next call/SMS
 * starts a brand-new conversation + Slack thread (fresh turn count). Use this
 * between test runs from the same phone number — otherwise the conversation row
 * is reused and caller turns accumulate toward the §9.3 cap.
 *
 *   node scripts/reset-test-conversation.mjs +1XXXXXXXXXX            # all operators
 *   node scripts/reset-test-conversation.mjs +1XXXXXXXXXX <op-email> # one operator
 *
 * Marks matching conversations 'abandoned' and back-dates last_message_at past
 * the 60-min resume window so getOrCreate won't reopen them. Read-mostly; only
 * touches conversation status/timestamps (no message deletion).
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const phone = process.argv[2];
const opEmail = process.argv[3] ?? null;
if (!phone) {
  console.error('Usage: node scripts/reset-test-conversation.mjs +1XXXXXXXXXX [operator-email]');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

let operatorId = null;
if (opEmail) {
  const { data: users } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = users?.users?.find((u) => u.email === opEmail);
  if (!user) {
    console.error(`No auth user for ${opEmail}`);
    process.exit(1);
  }
  const { data: op } = await db.from('operators').select('id').eq('user_id', user.id).maybeSingle();
  operatorId = op?.id ?? null;
}

let q = db
  .from('conversations')
  .select('id, status, started_at, last_message_at')
  .eq('caller_phone_e164', phone)
  .not('status', 'in', '(completed,abandoned)');
if (operatorId) q = q.eq('operator_id', operatorId);
const { data: active, error } = await q;
if (error) throw error;

if (!active || active.length === 0) {
  console.log(`No active conversations for ${phone}${operatorId ? ' (this operator)' : ''}. Next call starts fresh.`);
  process.exit(0);
}

const backdated = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
for (const c of active) {
  const { error: updErr } = await db
    .from('conversations')
    .update({ status: 'abandoned', last_message_at: backdated })
    .eq('id', c.id);
  console.log(updErr ? `  FAIL ${c.id}: ${updErr.message}` : `  reset ${c.id} (was ${c.status})`);
}
console.log(`\nDone — ${active.length} conversation(s) closed. Next call from ${phone} starts a fresh thread.`);
