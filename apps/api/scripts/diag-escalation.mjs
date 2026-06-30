import { createClient } from '@supabase/supabase-js';

/**
 * Read-only diagnostic for a stuck escalation / un-bridged HITL reply.
 *   node scripts/diag-escalation.mjs <convo-id-prefix>
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env.
 */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const prefix = process.argv[2];
if (!prefix) {
  console.error('Usage: node scripts/diag-escalation.mjs <convo-id-prefix>');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// `id` is a uuid column — Postgres rejects LIKE on uuid, so fetch recent and
// filter the prefix client-side. Pass a full uuid OR an 8-char prefix.
const { data: all } = await db
  .from('conversations')
  .select('*')
  .order('started_at', { ascending: false })
  .limit(500);
const convos = (all ?? [])
  .filter((c) => c.id.startsWith(prefix))
  .sort((a, b) => (a.started_at < b.started_at ? -1 : 1));

if (!convos?.length) {
  console.log(`No conversation with id prefix ${prefix}`);
  process.exit(0);
}

for (const c of convos) {
  console.log(`\n=== conversation ${c.id} ===`);
  console.log(`  caller=${c.caller_phone_e164} status=${c.status} outcome=${c.outcome ?? '-'}`);
  console.log(`  started=${c.started_at} last_msg=${c.last_message_at}`);
  console.log(`  slack_channel_id=${c.slack_channel_id ?? '-'} slack_thread_ts=${c.slack_thread_ts ?? '-'}`);

  const { data: escs } = await db
    .from('escalations')
    .select('*')
    .eq('conversation_id', c.id)
    .order('created_at', { ascending: true });
  console.log(`  escalations: ${escs?.length ?? 0}`);
  for (const e of escs ?? []) {
    console.log(
      `    - id=${e.id.slice(0, 8)} status=${e.status} reason=${e.reason} opened_by=${e.opened_by}`,
    );
    console.log(
      `      slack_channel_id=${e.slack_channel_id ?? '-'} slack_thread_ts=${e.slack_thread_ts ?? '-'} fallback_email_sent_at=${e.fallback_email_sent_at ?? '-'}`,
    );
  }

  const { data: msgs } = await db
    .from('messages')
    .select('role, body, created_at, twilio_message_sid, slack_message_ts, slack_channel_id')
    .eq('conversation_id', c.id)
    .order('created_at', { ascending: true });
  console.log(`  messages: ${msgs?.length ?? 0}`);
  for (const m of msgs ?? []) {
    const body = (m.body ?? '').replace(/\s+/g, ' ').slice(0, 70);
    console.log(
      `    [${m.created_at?.slice(11, 19)}] ${m.role.padEnd(6)} sid=${m.twilio_message_sid ? 'Y' : '-'} slackTs=${m.slack_message_ts ? 'Y' : '-'} | ${body}`,
    );
  }
}
