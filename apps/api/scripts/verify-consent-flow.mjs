import { createClient } from '@supabase/supabase-js';

/**
 * §9 A2P consent + IVR verifier. Run after the web opt-in and after the phone
 * call to confirm the rows landed. Read-only.
 *
 *   node scripts/verify-consent-flow.mjs                 # last 10 consents + recent convos
 *   node scripts/verify-consent-flow.mjs +13855551234    # focus on one caller number
 *
 * The caller number is the phone you CALL FROM (voice IVR) or enter in the web
 * opt-in form. Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const phone = process.argv[2] ?? null;
const db = createClient(url, key, { auth: { persistSession: false } });

// --- sms_consents (web_opt_in + voice_ivr) ---
let cq = db
  .from('sms_consents')
  .select('source, phone_e164, name, consent_version, user_agent, created_at')
  .order('created_at', { ascending: false })
  .limit(phone ? 50 : 10);
if (phone) cq = cq.eq('phone_e164', phone);
const { data: consents, error: cErr } = await cq;
if (cErr) {
  console.error('sms_consents query error:', cErr.message);
  process.exit(1);
}
console.log(`\n=== sms_consents ${phone ? `for ${phone}` : '(last 10)'} — ${consents?.length ?? 0} ===`);
for (const c of consents ?? []) {
  console.log(`  ${c.created_at}  source=${c.source}  ${c.phone_e164}  v=${c.consent_version}  ua=${(c.user_agent ?? '').slice(0, 40)}`);
}
if (!consents || consents.length === 0) console.log('  (none)');

// --- conversations + opening SMS (only meaningful when a phone is given) ---
if (phone) {
  const { data: convos } = await db
    .from('conversations')
    .select('id, operator_id, status, outcome, started_at, last_message_at')
    .eq('caller_phone_e164', phone)
    .order('started_at', { ascending: false })
    .limit(5);
  console.log(`\n=== conversations for ${phone} — ${convos?.length ?? 0} ===`);
  for (const cv of convos ?? []) {
    const { data: msgs } = await db
      .from('messages')
      .select('role, body, twilio_message_sid, created_at')
      .eq('conversation_id', cv.id)
      .order('created_at', { ascending: true });
    console.log(`  convo ${cv.id}  status=${cv.status}  outcome=${cv.outcome ?? '—'}  started=${cv.started_at}`);
    for (const m of msgs ?? []) {
      console.log(`      [${m.role}] ${(m.body ?? '').slice(0, 60)}  sid=${m.twilio_message_sid ?? '—'}`);
    }
  }
  if (!convos || convos.length === 0) console.log('  (none — opening SMS never created a conversation)');
}
console.log('');
