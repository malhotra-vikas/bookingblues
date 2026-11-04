// Release E2E scenario. Run via scripts/e2e-release/run.sh (boots API + stripe listen).
//
// One new Insurance Agency operator walks the whole journey:
//   signup → Stripe TEST Checkout (Solo, real hosted page, card 4242) → trialing →
//   onboarding (insurance) → missed call → real AI conversation (OpenAI) → booking with
//   encrypted intake answers → Solo 80%/100% emails → Solo blocks new callers →
//   upgrade to Crew → blocked caller admitted → end trial (paid) → Crew 80%/100% emails →
//   test-clock renewal with a $200 overage line → failed renewal → AI paused + email →
//   card fixed → resumed + email → operator view → admin view → tenant isolation.
//
// Steps never abort the run: each one records ✓/✗ so a single run shows every problem.

import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOGS = resolve(here, '.logs');
const req = createRequire(resolve(here, '../../apps/api/package.json'));
const { createClient } = req('@supabase/supabase-js');
const Stripe = req('stripe');
const rootReq = createRequire(resolve(here, '../../package.json'));
const { chromium } = rootReq('playwright');

const API = process.env.API_URL;
const APP = process.env.APP_URL;
const CAPTURE = process.env.E2E_CAPTURE_FILE;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
if (!process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('refusing: not a Stripe test key');

const run = crypto.randomUUID().slice(0, 6);
const PASSWORD = `e2e-${run}-Passw0rd!`;
const BUSINESS = `Summit Senior Insurance ${run}`;
const OP_NUMBER = `+1555${String(crypto.randomInt(1_000_000, 9_999_999))}`;
/** apps/api/src/modules/billing/plan-limits.ts TRIAL_PEOPLE_LIMIT — any plan, while a Stripe trial runs. */
const TRIAL_CAP = 30;
const SOLO_LIMIT = 80;
const CREW_LIMIT = 500;
const brand = readFileSync(resolve(here, '../../apps/web/lib/brand.ts'), 'utf8');
const TERMS_VERSION = /version:\s*'([^']+)'/.exec(brand.slice(brand.indexOf('TERMS')))?.[1] ?? 'unknown';

// ── tiny reporting framework ─────────────────────────────────────────────────
const results = [];
let current = null;
async function stage(name, fn) {
  console.log(`\n━━ ${name}`);
  current = name;
  try {
    await fn();
  } catch (err) {
    fail(`stage crashed: ${err?.message ?? err}`);
  }
}
function ok(msg) {
  results.push({ stage: current, ok: true, msg });
  console.log(`  ✓ ${msg}`);
}
function fail(msg) {
  results.push({ stage: current, ok: false, msg });
  console.log(`  ✗ ${msg}`);
}
function check(cond, msg, detail) {
  if (cond) ok(msg);
  else fail(detail ? `${msg} — ${detail}` : msg);
  return Boolean(cond);
}
function info(msg) {
  console.log(`    · ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn, { timeout = 60_000, every = 1_000 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) return null;
    await sleep(every);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
const tokens = new Map();
async function login(email, password) {
  const c = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  tokens.set(email, data.session.access_token);
  return c;
}
async function api(path, { method = 'GET', body, as, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (as) h.authorization = `Bearer ${tokens.get(as)}`;
  const res = await fetch(`${API}${path}`, { method, headers: h, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, body: json, text };
}
async function twilio(path, params) {
  const url = `${API}${path}`;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const sig = crypto.createHmac('sha1', process.env.TWILIO_AUTH_TOKEN).update(data).digest('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig },
    body: new URLSearchParams(params).toString(),
  });
  return { status: res.status, text: await res.text() };
}
let smsSeq = 0;
const sms = (operatorId, from, body) =>
  twilio(`/webhooks/twilio/sms/${operatorId}`, { MessageSid: `SM_e2e_${run}_${++smsSeq}`, From: from, To: OP_NUMBER, Body: body });
/** A real AI turn — not the limit/paused notice and not the advance-failure fallback. */
const isAiReply = (m) => !/follow up|text you back shortly/i.test(m.body);
const phone = () =>`+1732${String(crypto.randomInt(2_000_000, 9_999_999))}`;

async function operatorRow(id) {
  const { data } = await db.from('operators').select('*').eq('id', id).single();
  return data;
}
async function messages(operatorId, caller) {
  const { data } = await db
    .from('conversations')
    .select('id, status, messages(role, body, created_at)')
    .eq('operator_id', operatorId)
    .eq('caller_phone_e164', caller)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const msgs = (data?.messages ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { convo: data, msgs };
}
async function botRepliesAfter(operatorId, caller, sinceIso, timeout = 90_000) {
  return eventually(
    async () => {
      const { msgs } = await messages(operatorId, caller);
      // Booking confirmations are stored as 'system' (book() texts them directly).
      const replies = msgs.filter((m) => (m.role === 'bot' || m.role === 'system') && m.created_at > sinceIso);
      return replies.length ? replies : null;
    },
    { timeout, every: 1_500 },
  );
}
function captured(kind) {
  return readFileSync(CAPTURE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => !kind || c.kind === kind);
}
async function seedPeople(operatorId, windowStartIso, n) {
  const rows = Array.from({ length: n }, (_, i) => ({
    operator_id: operatorId,
    window_start: windowStartIso,
    caller_phone_e164: `+1999${run.replace(/[^0-9]/g, '0').slice(0, 2)}${String(i).padStart(5, '0')}`,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('usage_callers').upsert(rows.slice(i, i + 500), { ignoreDuplicates: true, onConflict: 'operator_id,window_start,caller_phone_e164' });
    if (error) throw error;
  }
}
async function countPeople(operatorId, windowStartIso) {
  const { count } = await db.from('usage_callers').select('id', { count: 'exact', head: true }).eq('operator_id', operatorId).eq('window_start', windowStartIso);
  return count ?? 0;
}
async function advanceClock(clockId, toUnix) {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: toUnix });
  return eventually(async () => (await stripe.testHelpers.testClocks.retrieve(clockId)).status === 'ready', { timeout: 180_000, every: 2_000 });
}
function emailsTo(addr, subjectRe) {
  return captured('email').filter((e) => [].concat(e.body?.to ?? []).includes(addr) && (!subjectRe || subjectRe.test(e.body?.subject ?? '')));
}

// ── state shared across stages ───────────────────────────────────────────────
const S = {
  email: `e2e-ins-${run}@e2e.test`,
  adminEmail: `e2e-admin-${run}@e2e.test`,
  otherEmail: `e2e-plumber-${run}@e2e.test`,
};

await stage('0. setup: admin user + second (plumbing) tenant', async () => {
  const { data: a, error } = await db.auth.admin.createUser({
    email: S.adminEmail, password: PASSWORD, email_confirm: true,
    app_metadata: { role: 'admin' }, user_metadata: { terms_version: TERMS_VERSION },
  });
  if (error) throw error;
  S.adminId = a.user.id;
  await login(S.adminEmail, PASSWORD);
  ok('admin user created');

  const { data: o } = await db.auth.admin.createUser({ email: S.otherEmail, password: PASSWORD, email_confirm: true, user_metadata: { terms_version: TERMS_VERSION } });
  const { data: other } = await db.from('operators').insert({
    user_id: o.user.id, business_name: `Other Plumbing ${run}`, category: 'plumbing', subscription_status: 'active', plan: 'crew',
    timezone: 'America/New_York', twilio_number_e164: `+1555${String(crypto.randomInt(1_000_000, 9_999_999))}`, onboarding_completed_at: new Date().toISOString(),
  }).select('id').single();
  S.otherId = other.id;
  const { data: oc } = await db.from('conversations').insert({ operator_id: other.id, caller_phone_e164: phone(), status: 'awaiting_caller' }).select('id').single();
  S.otherConvoId = oc.id;
  S.otherClient = await login(S.otherEmail, PASSWORD);
  ok('second tenant (plumbing) with its own conversation created');
});

await stage('1. signup (Supabase auth, as the web signup form does)', async () => {
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signUp({
    email: S.email, password: PASSWORD,
    options: { data: { business_name: BUSINESS, terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION } },
  });
  check(!error && data.user, 'auth user created', error?.message);
  S.userId = data.user?.id;
  S.client = await login(S.email, PASSWORD);
  const me = await api('/v1/operators/me', { as: S.email });
  check(me.status === 200 && me.body?.id, 'GET /v1/operators/me bootstraps the operator row', `status ${me.status} ${me.text.slice(0, 200)}`);
  S.opId = me.body?.id;
  check(me.body?.terms_version === TERMS_VERSION, `terms version recorded (${TERMS_VERSION})`, `got ${me.body?.terms_version}`);
});

await stage('2. Stripe TEST checkout — Solo monthly, real hosted Checkout page, card 4242', async () => {
  // Test-only: put the Stripe customer on a test clock so we can fast-forward to renewal later.
  // checkout-session reuses operators.stripe_customer_id when it is set.
  // Start the clock a day in the past: "end trial now" later (after advancing the clock to the
  // real present) then opens a genuinely new billing period that real time sits inside.
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: Math.floor(Date.now() / 1000) - 86_400, name: `e2e ${run}` });
  S.clockId = clock.id;
  const cus = await stripe.customers.create({ email: S.email, name: BUSINESS, test_clock: clock.id, metadata: { operator_id: S.opId, e2e: run } });
  S.customerId = cus.id;
  await db.from('operators').update({ stripe_customer_id: cus.id }).eq('id', S.opId);
  info(`test clock ${clock.id}, customer ${cus.id}`);

  const r = await api('/v1/billing/checkout-session', { method: 'POST', as: S.email, body: { plan: 'solo', cadence: 'monthly', business_name: BUSINESS } });
  check(r.status === 201 || r.status === 200, 'checkout session created', `${r.status} ${r.text.slice(0, 300)}`);
  if (!r.body?.url) return;
  const session = await stripe.checkout.sessions.retrieve(r.body.url.split('/pay/')[1]?.split('#')[0] ?? '', { expand: ['line_items'] }).catch(() => null);
  if (session) {
    check(session.line_items?.data?.[0]?.price?.id === process.env.STRIPE_PRICE_SOLO_MONTHLY, 'session uses the Solo monthly price ($199)');
    check(!session.discounts?.length && !session.total_details?.amount_discount, 'no Founding coupon (promo off)', JSON.stringify(session.discounts));
  }

  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.E2E_HEADED !== '1' });
  try {
    const page = await browser.newPage();
    await page.goto(r.body.url, { waitUntil: 'domcontentloaded' });
    // This account offers several payment methods (Card, Cash App, Klarna, Bank): pick Card.
    await page.getByText('Payment method').waitFor({ timeout: 30_000 }).catch(() => {});
    // The accordion overlay button never settles (animation), so dispatch the click directly.
    const accordion = page.locator('[data-testid="card-accordion-item-button"]');
    if (await accordion.count()) await accordion.dispatchEvent('click');
    await page.locator('#cardNumber').fill('4242424242424242', { timeout: 30_000 });
    await page.locator('#cardExpiry').fill('12 / 34');
    await page.locator('#cardCvc').fill('123');
    await page.locator('#billingName').fill('Maria Agent');
    const zip = page.locator('#billingPostalCode');
    if (await zip.isVisible().catch(() => false)) await zip.fill('10001');
    const pass = page.locator('#enableStripePass');
    if (await pass.isChecked().catch(() => false)) await pass.uncheck();
    const toSuccess = page.waitForRequest((q) => q.url().startsWith(APP), { timeout: 90_000 });
    await page.locator('[data-testid="hosted-payment-submit-button"]').click();
    const landed = await toSuccess.catch(() => null);
    check(landed && landed.url().includes('subscription=success'), 'Checkout redirected to /dashboard?subscription=success', landed?.url());
  } catch (err) {
    await browser.contexts()[0]?.pages()[0]?.screenshot({ path: resolve(LOGS, 'checkout-failure.png') }).catch(() => {});
    fail(`hosted checkout automation failed: ${err.message} (screenshot .logs/checkout-failure.png)`);
  } finally {
    await browser.close();
  }

  const op = await eventually(async () => {
    const o = await operatorRow(S.opId);
    return o.subscription_status === 'trialing' && o.plan === 'solo' ? o : null;
  });
  check(op, 'webhook → operator trialing on Solo', JSON.stringify(await operatorRow(S.opId).then((o) => ({ s: o.subscription_status, p: o.plan }))));
  if (op) {
    S.subId = op.stripe_subscription_id;
    const days = (new Date(op.trial_ends_at) - Date.now()) / 86_400_000;
    check(days > 5.5 && days < 6.5, `trial_ends_at = 7 days after signup (clock started 1 day back → ${days.toFixed(1)}d from now)`);
    check(op.current_period_start, 'current_period_start synced (usage window anchor)');
  }
});

await stage('3. onboarding as an Insurance Agency', async () => {
  const patch = await api('/v1/operators/me', { method: 'PATCH', as: S.email, body: { category: 'insurance' } });
  check(patch.status === 200 && patch.body?.category === 'insurance', 'PATCH category=insurance accepted (enabled)', `${patch.status} ${patch.text.slice(0, 200)}`);
  const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ start: '09:00', end: '17:00' }]]));
  const h = await api('/v1/operators/me', { method: 'PATCH', as: S.email, body: { business_hours: hours, timezone: 'America/New_York' } });
  check(h.status === 200, 'business hours + timezone saved', `${h.status} ${h.text.slice(0, 200)}`);

  // Twilio provisioning, phone verification and Google OAuth need the real providers:
  // seeded here exactly as their success paths would write them (the Chrome run covers the UI).
  await db.from('operators').update({
    personal_phone_e164: '+17325550199', twilio_number_e164: OP_NUMBER, twilio_number_sid: `PN_e2e_${run}`,
    google_calendar_id: 'primary', google_calendar_connected_at: new Date().toISOString(),
  }).eq('id', S.opId);
  const { error: cErr } = await db.from('calendar_connections').upsert({
    operator_id: S.opId, provider: 'google', encrypted_refresh_token: 'v1:e2e:not:used', access_token_cache: 'e2e_google_access',
    access_token_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), scopes: ['calendar.events', 'calendar.freebusy'],
    connected_email: 'e2e-calendar@e2e.test', status: 'active',
  }, { onConflict: 'operator_id' });
  check(!cErr, 'calendar connection seeded (Google is faked)', cErr?.message);

  const st = await api('/v1/operators/me/onboarding-status', { as: S.email });
  info(`onboarding steps: ${JSON.stringify(st.body?.steps)}`);
  check(st.body?.steps?.booking_fee_decided === true, 'deposit step auto-satisfied for insurance (no deposit)');
  check(st.body?.completed === true, 'onboarding complete');
  if (st.body?.completed) await db.from('operators').update({ onboarding_completed_at: new Date().toISOString() }).eq('id', S.opId);
});

await stage('4. missed call → greeting → press 1 → opening text', async () => {
  S.maria = phone();
  const greet = await twilio(`/webhooks/twilio/voice/${S.opId}`, { From: S.maria, To: OP_NUMBER, CallSid: `CA_e2e_${run}_1` });
  check(greet.status === 200 && greet.text.includes(BUSINESS.split(' ')[0]), 'voice webhook greets with business name', greet.text.slice(0, 300));
  const yes = await twilio(`/webhooks/twilio/voice/${S.opId}/consent?attempt=1`, { From: S.maria, To: OP_NUMBER, CallSid: `CA_e2e_${run}_1`, Digits: '1' });
  check(yes.status === 200, 'caller pressed 1 (SMS consent)', yes.text.slice(0, 200));
  const opening = await eventually(async () => (await messages(S.opId, S.maria)).msgs.find((m) => m.role === 'bot'));
  check(opening, 'opening text stored for the caller');
  if (opening) info(`opening: "${opening.body}"`);
  check(opening && !/address|emergency|deposit/i.test(opening.body), 'opening text is office-style (no address/emergency/deposit talk)');
});

await stage('5. real AI conversation (OpenAI) → booking with intake answers', async () => {
  const answer = (q) => {
    const t = q.toLowerCase();
    if (/(medicare (number|id)|mbi|social security|ssn)/.test(t)) return 'I would rather not share that by text.';
    if (/birth|dob|born/.test(t)) return 'March 14, 1955';
    if (/prescri|medication|medicine|drugs/.test(t)) return 'Metformin 500mg and Lisinopril 10mg';
    if (/doctor|physician|primary care|pcp/.test(t)) return 'Dr. Anil Patel at Summit Family Medicine';
    if (/name/.test(t)) return 'Maria Lopez';
    if (/email/.test(t)) return 'No email, thanks';
    if (/confirm|correct|right\?|look good/.test(t)) return 'Yes, that is correct';
    if (/\b(am|pm)\b|slot|time works|which (time|one)|available/.test(t)) return 'The first time you offered works for me';
    return 'Yes please';
  };
  let say = "Hi, I'd like to set up a meeting to go over my Medicare plan options.";
  const transcript = [];
  for (let turn = 0; turn < 14; turn += 1) {
    const since = new Date().toISOString();
    await sleep(50);
    const r = await sms(S.opId, S.maria, say);
    if (r.status !== 200) { fail(`SMS webhook ${r.status}`); break; }
    transcript.push(`CALLER: ${say}`);
    const replies = await botRepliesAfter(S.opId, S.maria, since);
    if (!replies) { fail(`no bot reply within 90s on turn ${turn + 1}`); break; }
    const last = replies.map((m) => m.body).join(' ');
    transcript.push(`BOT:    ${last}`);
    const { data: appt } = await db.from('appointments').select('*').eq('operator_id', S.opId).eq('caller_phone_e164', S.maria).maybeSingle();
    if (appt) { S.appt = appt; break; }
    say = answer(last);
  }
  writeFileSync(resolve(LOGS, 'insurance-transcript.txt'), transcript.join('\n'));
  console.log(transcript.map((l) => `      ${l}`).join('\n'));
  const all = transcript.filter((l) => l.startsWith('BOT')).join(' ').toLowerCase();
  check(S.appt, 'appointment booked by the AI');
  check(/birth/.test(all), 'bot asked for date of birth');
  check(/doctor|physician/.test(all), 'bot asked for the doctor');
  check(/prescri|medication/.test(all), 'bot asked for prescriptions');
  // The booking confirmation itself says "bring your Medicare card (it shows your
  // Medicare number/MBI) … please don't text us your Medicare number" — that's
  // the opposite of asking, so it's excluded; every other bot line must not ask.
  const asks = transcript
    .filter((l) => l.startsWith('BOT') && !/you're booked/i.test(l))
    .join(' ')
    .toLowerCase();
  check(!/medicare (number|id)|\bmbi\b|social security/.test(asks), 'bot never asked for MBI/SSN');
  check(/please bring your medicare card/.test(all), 'confirmation lists what to bring (Medicare card, …)');
  check(/don't text us your medicare number/.test(all), 'confirmation tells the caller NOT to text their Medicare number');
  check(!/address|deposit|emergency/.test(all), 'bot never asked for an address, a deposit or about emergencies');
  if (!S.appt) return;
  check(S.appt.status === 'confirmed', `appointment status confirmed (${S.appt.status})`);
  check((new Date(S.appt.scheduled_for_end) - new Date(S.appt.scheduled_for_start)) / 60_000 > 0, 'appointment has a time window');
  const enc = S.appt.intake_answers_enc ?? '';
  check(enc && !/metformin|1955|patel/i.test(enc), 'intake answers stored ENCRYPTED on the appointment (no plaintext)');
  check(!/metformin|lisinopril|1955/i.test(S.appt.job_summary ?? ''), 'job_summary has no health data', S.appt.job_summary);

  const ev = captured('google_event_post').at(-1);
  const desc = ev?.body?.description ?? '';
  check(ev, 'Google Calendar event created');
  check(/metformin/i.test(desc) && /1955|03\/14|march 14/i.test(desc), 'calendar event description carries the intake answers (operator-private)');
  check(!/metformin|1955/i.test(ev?.body?.summary ?? ''), 'calendar event TITLE has no health data', ev?.body?.summary);
  const conf = emailsTo(S.email).find((e) => /metformin/i.test(e.body?.html ?? ''));
  check(conf, 'operator booking email includes the intake answers');
  const slackLeak = captured('slack').filter((c) => /metformin|1955|lisinopril/i.test(JSON.stringify(c.body)));
  check(slackLeak.length === 0, 'no health data posted to Slack', `${slackLeak.length} Slack posts contain it`);
  const convoThreads = captured('slack').filter((c) => JSON.stringify(c.body ?? '').includes('C_E2E_CONVOS') && JSON.stringify(c.body).includes(S.maria.slice(-4)));
  check(convoThreads.length === 0, 'no #convos monitoring thread for insurance conversations');
});

await stage('6. operator view (dashboard API)', async () => {
  const m = await api('/v1/dashboard/metrics', { as: S.email });
  check(m.status === 200, 'dashboard metrics load');
  info(`usage: ${JSON.stringify(m.body?.usage)}`);
  // During a Stripe trial every plan is capped at the trial limit (plan-limits.ts TRIAL_PEOPLE_LIMIT).
  check(
    m.body?.usage?.conversations_limit === TRIAL_CAP && m.body?.usage?.trial === true && m.body?.usage?.conversations_used >= 1,
    `usage meter shows the free-trial cap ${m.body?.usage?.conversations_used}/${m.body?.usage?.conversations_limit} (trial)`,
    JSON.stringify(m.body?.usage),
  );
  const appts = await api('/v1/appointments', { as: S.email });
  const mine = (appts.body?.items ?? appts.body?.data ?? appts.body ?? []).find?.((a) => a.id === S.appt?.id);
  check(mine, 'appointment listed for the operator');
  check(mine && !('intake_answers_enc' in mine), 'ciphertext column not sent to the browser');
  check(mine && JSON.stringify(mine.intake_answers ?? '').match(/metformin/i), 'decrypted intake answers shown to the operator', JSON.stringify(mine?.intake_answers));
  const convos = await api('/v1/conversations', { as: S.email });
  const convo = (convos.body?.items ?? convos.body?.data ?? convos.body ?? []).find?.((c) => c.caller_phone_e164 === S.maria);
  check(convo && !('intake_answers_enc' in convo), 'conversation listed, no ciphertext');
  S.mariaConvoId = convo?.id;
  const msgs = await api(`/v1/conversations/${S.mariaConvoId}/messages`, { as: S.email });
  check(msgs.status === 200, 'operator can read the transcript');
});

/**
 * Fill `window` to exactly `target - 1` people (real callers already in it are
 * kept), then text from a NEW number so person #target is counted by the real
 * SMS path. Returns that caller's number.
 */
async function fillTo(window, target, body) {
  const now = await countPeople(S.opId, window);
  const { count: seeded } = await db
    .from('usage_callers')
    .select('id', { count: 'exact', head: true })
    .eq('operator_id', S.opId)
    .eq('window_start', window)
    .like('caller_phone_e164', '+1999%');
  const real = now - (seeded ?? 0);
  await seedPeople(S.opId, window, target - 1 - real);
  const before = await countPeople(S.opId, window);
  check(before === target - 1, `${target - 1} people before caller #${target} (${before})`);
  const c = phone();
  await sms(S.opId, c, body);
  await eventually(async () => (await countPeople(S.opId, window)) >= target);
  return c;
}

/** Missed call + reply from a NEW number while at the limit: polite text, no AI, not counted. */
async function expectBlocked(window, label, used) {
  const c = phone();
  await twilio(`/webhooks/twilio/voice/${S.opId}`, { From: c, To: OP_NUMBER, CallSid: `CA_e2e_${run}_${label}` });
  await twilio(`/webhooks/twilio/voice/${S.opId}/consent?attempt=1`, { From: c, To: OP_NUMBER, CallSid: `CA_e2e_${run}_${label}`, Digits: '1' });
  const open = await eventually(async () => (await messages(S.opId, c)).msgs.find((m) => m.role === 'bot'));
  check(open && /follow up/i.test(open.body), `caller #${label} gets the polite "we'll follow up" text, not the AI`, open?.body);
  const since = new Date().toISOString();
  await sms(S.opId, c, 'Can I book a time to talk about Medicare?');
  await sleep(12_000);
  const after = (await messages(S.opId, c)).msgs.filter((m) => m.role === 'bot' && m.created_at > since);
  check(after.every((m) => /follow up/i.test(m.body)) && after.length <= 1, `caller #${label}'s text gets no AI reply (${after.length} follow-up notices)`, after.map((m) => m.body).join(' | '));
  check((await countPeople(S.opId, window)) === used, `caller #${label} NOT counted (still ${used})`);
  return c;
}

await stage(`7. free-trial cap (${TRIAL_CAP} people): 80% and 100% emails, then new callers blocked`, async () => {
  const { data: rows } = await db.from('usage_callers').select('window_start').eq('operator_id', S.opId).limit(1);
  S.trialWindow = rows?.[0]?.window_start;
  check(S.trialWindow, `Maria counted in window starting ${S.trialWindow}`);
  if (!S.trialWindow) return;

  const at80 = Math.ceil(TRIAL_CAP * 0.8); // 24
  await fillTo(S.trialWindow, at80, 'Hi, do you help with Medicare supplements?');
  check(await eventually(() => emailsTo(S.email, /80% of your free trial/i).length > 0, { timeout: 20_000 }), `operator got the trial 80% email (${at80}/${TRIAL_CAP})`);
  check(emailsTo(S.adminEmail).some((e) => /\[Trial 80%\]/.test(e.body?.subject ?? '')), 'admin got the trial 80% email');

  await fillTo(S.trialWindow, TRIAL_CAP, 'Hello, I need help picking a drug plan');
  check(await eventually(() => emailsTo(S.email, /free-trial limit/i).length > 0, { timeout: 20_000 }), `operator got the trial-limit email (${TRIAL_CAP}/${TRIAL_CAP})`);
  check(emailsTo(S.adminEmail).some((e) => /\[Trial 100%\]/.test(e.body?.subject ?? '')), 'admin got the trial 100% email');
  check(emailsTo(S.email, /80% of your free trial/i).length === 1, 'the trial 80% email was sent once, not repeated');

  S.blocked = await expectBlocked(S.trialWindow, TRIAL_CAP + 1, TRIAL_CAP);

  const since2 = new Date().toISOString();
  await sms(S.opId, S.maria, 'Thank you! What should I bring to the appointment?');
  const back = await botRepliesAfter(S.opId, S.maria, since2, 60_000);
  check(back && back.some(isAiReply), 'an already-counted caller (Maria) still gets the AI', back?.map((m) => m.body).join(' | '));
  // Regression (found 2026-11-04): the follow-up used to make the bot book Maria AGAIN.
  await sleep(3_000);
  const { data: mariaAppts } = await db.from('appointments').select('id, status').eq('operator_id', S.opId).eq('caller_phone_e164', S.maria).neq('status', 'cancelled');
  check(mariaAppts?.length === 1, `follow-up after booking does not create a second appointment (${mariaAppts?.length})`);
  const offersSlots = (b) =>
    /no longer available|just taken|available times|do any of these work|which (one|time)/i.test(b) ||
    (b.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length >= 2;
  check(back && !back.some((m) => offersSlots(m.body)), 'follow-up is not met with a fresh slot offer (bot knows she is booked)', back?.map((m) => m.body).join(' | '));
  info(`Maria's follow-up reply: ${back?.map((m) => m.body).join(' | ')}`);
  const m = await api('/v1/dashboard/metrics', { as: S.email });
  check(
    m.body?.usage?.conversations_used === TRIAL_CAP && m.body?.usage?.conversations_limit === TRIAL_CAP && m.body?.usage?.trial === true,
    `dashboard meter shows ${TRIAL_CAP}/${TRIAL_CAP} (trial)`,
    JSON.stringify(m.body?.usage),
  );
});

await stage('7b. caller reschedules by text → the SAME appointment moves (no duplicate)', async () => {
  // Regression (prod, 2026-11-04): "reschedule to Saturday" created a second
  // appointment and left the original standing.
  const before = S.appt;
  if (!before) return fail('no appointment to reschedule');
  const patchesBefore = captured('google_event_patch').length;
  let say = 'Hi, something came up. Can I move my appointment to a different day? A later day that week would be better.';
  const transcript = [];
  let moved = null;
  for (let turn = 0; turn < 6 && !moved; turn += 1) {
    const since = new Date().toISOString();
    await sleep(50);
    await sms(S.opId, S.maria, say);
    transcript.push(`CALLER: ${say}`);
    const replies = await botRepliesAfter(S.opId, S.maria, since, 90_000);
    if (!replies) { fail(`no bot reply within 90s on reschedule turn ${turn + 1}`); break; }
    const last = replies.map((m) => m.body).join(' ');
    transcript.push(`BOT:    ${last}`);
    const { data: row } = await db.from('appointments').select('*').eq('id', before.id).maybeSingle();
    if (row && row.scheduled_for_start !== before.scheduled_for_start) moved = row;
    say = /\b(am|pm)\b|slot|which (time|one)|available|work/i.test(last) ? 'The first time you offered works for me' : 'Yes please';
  }
  console.log(transcript.map((l) => `      ${l}`).join('\n'));
  const { data: live } = await db.from('appointments').select('id, status, scheduled_for_start').eq('operator_id', S.opId).eq('caller_phone_e164', S.maria).neq('status', 'cancelled');
  check(moved, 'the original appointment row now has the new time', transcript.slice(-2).join(' | '));
  check(live?.length === 1 && live[0].id === before.id, `still exactly ONE appointment for the caller (${live?.length})`, JSON.stringify(live));
  check(captured('google_event_patch').length > patchesBefore, 'the existing Google Calendar event was moved (PATCH), not a new one inserted');
  const texts = (await messages(S.opId, S.maria)).msgs.filter((m) => m.role === 'system' && /has been moved to/.test(m.body));
  check(texts.length >= 1, 'caller got the "your appointment has been moved" text', texts.at(-1)?.body);
  check(moved && moved.reminder_sent_at == null, 'the 24h reminder is re-armed for the new time');
  if (moved) S.appt = moved;
});

await stage('8. end trial early → first Solo charge (test card) → fresh window at the full Solo limit', async () => {
  const before = (await operatorRow(S.opId)).current_period_start;
  check(await advanceClock(S.clockId, Math.floor(Date.now() / 1000) - 5), 'test clock brought to the real present (1 day into the trial)');
  const r = await api('/v1/billing/end-trial', { method: 'POST', as: S.email });
  check(r.status < 300, `POST /v1/billing/end-trial (${r.status})`, r.text.slice(0, 200));
  const op = await eventually(async () => {
    const o = await operatorRow(S.opId);
    return o.subscription_status === 'active' && o.current_period_start !== before ? o : null;
  }, { timeout: 90_000 });
  check(op, 'webhook → active, new billing period');
  S.paidWindow = op?.current_period_start ? new Date(op.current_period_start).toISOString() : null;
  S.periodEnd = op?.current_period_end;
  const inv = S.subId ? (await stripe.invoices.list({ subscription: S.subId, limit: 5 })).data.find((i) => i.amount_paid > 0) : null;
  check(inv && inv.status === 'paid' && inv.amount_paid === 19_900, `first Solo invoice PAID in Stripe test mode: $${(inv?.amount_paid ?? 0) / 100} (expect $199)`);
  const { data: trialCharges } = await db.from('usage_overage_charges').select('*').eq('operator_id', S.opId);
  check(!trialCharges?.some((c) => c.amount_cents > 0), 'usage during the trial is never billed as overage');
  const m = await api('/v1/dashboard/metrics', { as: S.email });
  check(
    m.body?.usage?.conversations_used === 0 && m.body?.usage?.conversations_limit === SOLO_LIMIT && m.body?.usage?.trial === false,
    `meter reset to 0/${SOLO_LIMIT} for the paid period`,
    JSON.stringify(m.body?.usage),
  );
  const since = new Date().toISOString();
  await sms(S.opId, S.blocked, 'Hi again, can we set up a call about Medicare Advantage?');
  const replies = await botRepliesAfter(S.opId, S.blocked, since, 90_000);
  check(replies && replies.some(isAiReply), 'the caller blocked during the trial now gets the AI', replies?.map((m) => m.body).join(' | '));
});

await stage(`9. Solo paid plan (${SOLO_LIMIT} people): 80% and 100% emails, then new callers blocked`, async () => {
  if (!S.paidWindow) return fail('no paid window');
  const mailsBefore = emailsTo(S.email).length;
  const at80 = Math.ceil(SOLO_LIMIT * 0.8); // 64
  await fillTo(S.paidWindow, at80, 'Hi, do you help with Medicare supplements?');
  const soloMails = () => emailsTo(S.email).slice(mailsBefore).map((e) => e.body?.subject ?? '');
  check(await eventually(() => soloMails().some((s) => /80%/.test(s) && !/trial/i.test(s)), { timeout: 20_000 }), `operator got the Solo 80% email (${at80}/${SOLO_LIMIT})`, JSON.stringify(soloMails()));
  check(emailsTo(S.adminEmail).some((e) => /80%/.test(e.body?.subject ?? '') && !/Trial/.test(e.body?.subject ?? '')), 'admin got the Solo 80% email');

  await fillTo(S.paidWindow, SOLO_LIMIT, 'Hello, I need help picking a drug plan');
  check(await eventually(() => soloMails().some((s) => /100%|limit|reached/i.test(s)), { timeout: 20_000 }), `operator got the Solo 100% email (${SOLO_LIMIT}/${SOLO_LIMIT})`, JSON.stringify(soloMails()));
  check(soloMails().filter((s) => /80%/.test(s)).length === 1, 'the Solo 80% email was sent once, not repeated');

  S.blockedSolo = await expectBlocked(S.paidWindow, SOLO_LIMIT + 1, SOLO_LIMIT);
  const m = await api('/v1/dashboard/metrics', { as: S.email });
  check(m.body?.usage?.conversations_used === SOLO_LIMIT && m.body?.usage?.conversations_limit === SOLO_LIMIT, `dashboard meter shows ${SOLO_LIMIT}/${SOLO_LIMIT}`, JSON.stringify(m.body?.usage));
});

await stage('10. upgrade Solo → Crew mid-period (prorated charge paid) → limit lifts', async () => {
  const sub = await stripe.subscriptions.retrieve(S.subId);
  // Prorations are invoiced right away so the renewal invoice (stage 12) is clean.
  await stripe.subscriptions.update(S.subId, {
    items: [{ id: sub.items.data[0].id, price: process.env.STRIPE_PRICE_CREW_MONTHLY }],
    proration_behavior: 'always_invoice',
  });
  const op = await eventually(async () => ((await operatorRow(S.opId)).plan === 'crew' ? true : null));
  check(op, 'webhook → operator plan is now crew');
  const proration = await eventually(async () => {
    const i = (await stripe.invoices.list({ subscription: S.subId, limit: 3 })).data[0];
    return i && i.billing_reason === 'subscription_update' && i.status === 'paid' ? i : null;
  }, { timeout: 60_000, every: 2_000 });
  check(proration, `prorated upgrade invoice PAID: $${(proration?.amount_paid ?? 0) / 100}`);
  const m = await api('/v1/dashboard/metrics', { as: S.email });
  check(
    m.body?.usage?.conversations_limit === CREW_LIMIT && m.body?.usage?.policy === 'overage',
    `meter now ${m.body?.usage?.conversations_used}/${CREW_LIMIT}, overage instead of block`,
    JSON.stringify(m.body?.usage),
  );
  const since = new Date().toISOString();
  await sms(S.opId, S.blockedSolo, 'Hi again, are you able to help me now?');
  const replies = await botRepliesAfter(S.opId, S.blockedSolo, since, 90_000);
  check(replies && replies.some(isAiReply), 'the caller blocked on Solo now gets the AI on Crew', replies?.map((m) => m.body).join(' | '));
});

await stage('11. Crew over the limit: 80%/100% emails, AI keeps working (overage, no block)', async () => {
  if (!S.paidWindow) return fail('no paid window');
  S.crewWindow = S.paidWindow;
  const before = emailsTo(S.email).length;
  const c = await fillTo(S.crewWindow, 551, 'Hi, I just turned 65 and need help with Medicare.');
  const replies = await botRepliesAfter(S.opId, c, new Date(Date.now() - 60_000).toISOString(), 90_000);
  check(replies && replies.some(isAiReply), 'caller #551 still gets the AI on Crew (overage, not blocked)');
  const used = await countPeople(S.opId, S.crewWindow);
  check(used === 551, `551 people this window (${used})`);
  const newMails = emailsTo(S.email).slice(before).map((e) => e.body?.subject);
  info(`new operator emails: ${JSON.stringify(newMails)}`);
  check(newMails.some((s) => /80%/.test(s)) && newMails.some((s) => /100%|limit|over/i.test(s)), 'operator got Crew 80% + 100% emails');
  const m = await api('/v1/dashboard/metrics', { as: S.email });
  info(`meter: ${JSON.stringify(m.body?.usage)}`);
});

await stage('12. renewal (test clock) → $200 overage added to the Crew invoice and paid', async () => {
  if (!S.periodEnd) return fail('no period end');
  const target = Math.floor(new Date(S.periodEnd).getTime() / 1000) + 120;
  check(await advanceClock(S.clockId, target), 'test clock advanced to renewal');
  const charge = await eventually(async () => {
    const { data } = await db.from('usage_overage_charges').select('*').eq('operator_id', S.opId).eq('status', 'invoiced').maybeSingle();
    return data;
  }, { timeout: 120_000, every: 2_000 });
  check(charge, 'invoice.created webhook → overage claimed + invoiced');
  if (charge) {
    check(charge.people_used === 551 && charge.batches === 2 && charge.amount_cents === 20_000, `551 used / 500 → 2 batches → $${charge.amount_cents / 100}`, JSON.stringify(charge));
    S.renewalInvoice = charge.stripe_invoice_id;
  }
  check(await advanceClock(S.clockId, target + 2 * 3600), 'clock +2h (invoice finalizes and charges)');
  const inv = await eventually(async () => {
    const i = await stripe.invoices.retrieve(S.renewalInvoice, { expand: ['lines'] });
    return i.status === 'paid' ? i : null;
  }, { timeout: 120_000, every: 3_000 });
  check(inv, 'renewal invoice PAID in Stripe test mode');
  if (inv) {
    const lines = inv.lines.data.map((l) => `${l.description} = $${l.amount / 100}`);
    info(lines.join('\n      '));
    check(inv.lines.data.some((l) => l.amount === 20_000 && /overage/i.test(l.description ?? '')), 'invoice has the $200 overage line');
    check(inv.amount_paid === 65_000 + 20_000, `total charged $${inv.amount_paid / 100} (Crew $650 + $200 overage)`);
  }
});

await stage('13. failed renewal → past_due → AI paused + email; card fixed → resumed + email', async () => {
  const pm = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: S.customerId });
  await stripe.customers.update(S.customerId, { invoice_settings: { default_payment_method: pm.id } });
  await stripe.subscriptions.update(S.subId, { default_payment_method: pm.id });
  const sub = await stripe.subscriptions.retrieve(S.subId);
  const next = (sub.items.data[0].current_period_end ?? sub.current_period_end) + 120;
  check(await advanceClock(S.clockId, next), 'clock → next renewal');
  await advanceClock(S.clockId, next + 2 * 3600);
  const pd = await eventually(async () => ((await operatorRow(S.opId)).subscription_status === 'past_due' ? true : null), { timeout: 120_000 });
  check(pd, 'operator is past_due after the declined renewal');
  check(await eventually(() => emailsTo(S.email, /payment|failed|declined|update your card/i).length > 0, { timeout: 30_000 }), 'operator got the payment-failed email');
  check(emailsTo(S.adminEmail).some((e) => /payment|failed/i.test(e.body?.subject ?? '')), 'admin got the payment-failed email');

  const since = new Date().toISOString();
  await sms(S.opId, S.maria, 'Hi, I need to ask about my appointment');
  await sleep(12_000);
  const replies = (await messages(S.opId, S.maria)).msgs.filter((m) => m.role === 'bot' && m.created_at > since);
  check(replies.every((m) => /follow up/i.test(m.body)), `AI paused while past_due (${replies.length} replies, all polite follow-up)`, replies.map((m) => m.body).join(' | '));

  const good = await stripe.paymentMethods.attach('pm_card_visa', { customer: S.customerId });
  await stripe.customers.update(S.customerId, { invoice_settings: { default_payment_method: good.id } });
  await stripe.subscriptions.update(S.subId, { default_payment_method: good.id });
  const open = (await stripe.invoices.list({ subscription: S.subId, status: 'open', limit: 1 })).data[0];
  if (open) await stripe.invoices.pay(open.id, { payment_method: good.id });
  const active = await eventually(async () => ((await operatorRow(S.opId)).subscription_status === 'active' ? true : null), { timeout: 90_000 });
  check(active, 'paying the open invoice → active again');
  check(await eventually(() => emailsTo(S.email, /resum|back on|active again/i).length > 0, { timeout: 30_000 }), 'operator got the "resumed" email');
});

await stage('14. admin view', async () => {
  const metrics = await api('/v1/admin/metrics', { as: S.adminEmail });
  check(metrics.status === 200, 'admin metrics load');
  const list = await api(`/v1/admin/operators?q=${encodeURIComponent(BUSINESS)}`, { as: S.adminEmail });
  check(list.status === 200 && JSON.stringify(list.body).includes(S.opId), 'admin finds the insurance operator by name');
  const dossier = await api(`/v1/admin/operators/${S.opId}`, { as: S.adminEmail });
  check(dossier.status === 200, 'admin dossier loads');
  info(`dossier plan/status: ${dossier.body?.operator?.plan ?? dossier.body?.plan} / ${dossier.body?.operator?.subscription_status ?? dossier.body?.subscription_status}; keys: ${Object.keys(dossier.body ?? {}).join(', ')}`);
  const conv = await api(`/v1/admin/operators/${S.opId}/conversations`, { as: S.adminEmail });
  check(conv.status === 200, 'admin conversations load', `${conv.status} ${conv.text.slice(0, 200)}`);
  check(!JSON.stringify(conv.body).includes('intake_answers_enc'), 'admin conversations payload has no intake ciphertext');
  const ap = await api(`/v1/admin/operators/${S.opId}/appointments`, { as: S.adminEmail });
  check(ap.status === 200, 'admin appointments load');
  info(`admin appointment payload exposes ciphertext: ${JSON.stringify(ap.body).includes('intake_answers_enc')}; shows decrypted answers: ${/metformin/i.test(JSON.stringify(ap.body))}`);
  const charges = await api(`/v1/admin/operators/${S.opId}/subscription-charges`, { as: S.adminEmail });
  check(charges.status === 200, `admin sees live Stripe subscription charges (${JSON.stringify(charges.body).match(/ch_|py_/g)?.length ?? 0} charges)`);
  const audit = await api(`/v1/admin/operators/${S.opId}/audit-log`, { as: S.adminEmail });
  check(audit.status === 200, 'admin audit log loads');
});

await stage('15. tenant isolation', async () => {
  const otherOp = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await otherOp.auth.signInWithPassword({ email: S.otherEmail, password: PASSWORD });
  const r1 = await api(`/v1/conversations/${S.mariaConvoId}/messages`, { as: S.otherEmail });
  check(r1.status === 404 || r1.status === 403, `other operator cannot read the insurance transcript via API (${r1.status})`);
  const r2 = await api(`/v1/conversations/${S.otherConvoId}/messages`, { as: S.email });
  check(r2.status === 404 || r2.status === 403, `insurance operator cannot read the plumber's transcript (${r2.status})`);
  const ap = await api('/v1/appointments', { as: S.otherEmail });
  check(!JSON.stringify(ap.body).includes(S.appt?.id ?? 'none'), "other operator's appointment list excludes the insurance booking");
  for (const t of ['appointments', 'conversations', 'messages', 'usage_callers', 'usage_alerts', 'usage_overage_charges', 'calendar_connections']) {
    const col = t === 'messages' ? 'conversation_id' : 'operator_id';
    const val = t === 'messages' ? S.mariaConvoId : S.opId;
    const { data, error } = await otherOp.from(t).select('id').eq(col, val);
    check(!error ? (data ?? []).length === 0 : true, `RLS: other operator sees 0 rows of ${t}`, `${data?.length} rows`);
  }
  check((await api('/v1/admin/metrics', { as: S.email })).status === 403, 'operator cannot call admin APIs');
  check((await api('/v1/billing/checkout-session', { method: 'POST', as: S.email, body: { plan: 'solo', cadence: 'monthly' } })).status === 409, 'second checkout refused while subscribed (no double billing)');
  const cron = await fetch(`${API}/v1/internal/usage/close-annual-windows`, { method: 'POST', headers: { 'x-cron-secret': 'wrong' } });
  check(cron.status === 401 || cron.status === 403, `usage cron rejects a wrong secret (${cron.status})`);
});

await stage('15b. trades (plumbing): book a job → caller reschedules → the SAME job moves', async () => {
  // Rescheduling works for every category, not just insurance.
  const PLUMB_NUMBER = `+1555${String(crypto.randomInt(1_000_000, 9_999_999))}`;
  const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ start: '08:00', end: '17:00' }]]));
  await db.from('operators').update({
    business_hours: hours, personal_phone_e164: '+17325550188', twilio_number_e164: PLUMB_NUMBER, twilio_number_sid: `PN_e2e_p_${run}`,
    google_calendar_id: 'primary', google_calendar_connected_at: new Date().toISOString(), booking_fee_enabled: false,
  }).eq('id', S.otherId);
  await db.from('calendar_connections').upsert({
    operator_id: S.otherId, provider: 'google', encrypted_refresh_token: 'v1:e2e:not:used', access_token_cache: 'e2e_google_access',
    access_token_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), scopes: ['calendar.events', 'calendar.freebusy'],
    connected_email: 'e2e-plumber@e2e.test', status: 'active',
  }, { onConflict: 'operator_id' });

  const joe = phone();
  const findJob = async () =>
    (await db.from('appointments').select('*').eq('operator_id', S.otherId).eq('caller_phone_e164', joe).neq('status', 'cancelled')).data ?? [];
  const tx = async (body) => {
    const since = new Date().toISOString();
    await sleep(50);
    await twilio(`/webhooks/twilio/sms/${S.otherId}`, { From: joe, To: PLUMB_NUMBER, Body: body, MessageSid: `SM_e2e_p_${crypto.randomUUID().slice(0, 8)}` });
    const replies = await eventually(async () => {
      const { data: c } = await db.from('conversations').select('id').eq('operator_id', S.otherId).eq('caller_phone_e164', joe);
      const ids = (c ?? []).map((x) => x.id);
      if (!ids.length) return null;
      const { data: m } = await db.from('messages').select('role, body, created_at').in('conversation_id', ids).in('role', ['bot', 'system']).gt('created_at', since).order('created_at');
      return m?.length ? m : null;
    }, { timeout: 90_000 });
    return (replies ?? []).map((m) => m.body).join(' ');
  };
  const answer = (q) => {
    const t = q.toLowerCase();
    if (/address|street/.test(t)) return '42 Oak Street, Edison NJ 08817';
    if (/zip/.test(t)) return '08817';
    if (/name/.test(t)) return 'Joe Rivera';
    if (/email/.test(t)) return 'No email, thanks';
    if (/emergenc|urgent|flood|active(ly)? leak/.test(t)) return 'Not an emergency, it just drips';
    if (/\b(am|pm)\b|slot|which (time|one)|available|work for you/.test(t)) return 'The first time you offered works for me';
    if (/how long|when did|where|which|what kind|describe|more detail|tell me/.test(t)) return 'Kitchen faucet, dripping for a week, standard single-handle faucet';
    return 'Yes please';
  };

  const transcript = [];
  let say = 'Hi, my kitchen faucet is dripping and I need a plumber to fix it.';
  for (let turn = 0; turn < 12; turn += 1) {
    transcript.push(`CALLER: ${say}`);
    const last = await tx(say);
    transcript.push(`BOT:    ${last}`);
    const jobs = await findJob();
    if (jobs[0]?.service_address) break;
    say = answer(last);
  }
  let jobs = await findJob();
  check(jobs.length === 1 && jobs[0].status === 'confirmed', `plumbing job booked (${jobs.length})`, transcript.slice(-2).join(' | '));
  check(jobs[0]?.service_address, 'service address collected after booking (address step still works)', jobs[0]?.service_address);
  const original = jobs[0];

  say = 'Actually something came up — can we move that appointment to a later day this week?';
  let moved = false;
  for (let turn = 0; turn < 6 && !moved && original; turn += 1) {
    transcript.push(`CALLER: ${say}`);
    const last = await tx(say);
    transcript.push(`BOT:    ${last}`);
    const { data: row } = await db.from('appointments').select('scheduled_for_start').eq('id', original.id).maybeSingle();
    moved = row && row.scheduled_for_start !== original.scheduled_for_start;
    say = answer(last);
  }
  writeFileSync(resolve(LOGS, 'plumbing-transcript.txt'), transcript.join('\n'));
  console.log(transcript.map((l) => `      ${l}`).join('\n'));
  jobs = await findJob();
  check(moved, 'the plumbing job now has the new time');
  check(jobs.length === 1 && jobs[0].id === original?.id, `still exactly ONE job for the caller (${jobs.length})`, JSON.stringify(jobs.map((j) => [j.id, j.scheduled_for_start])));
  check(!!original?.service_address && jobs[0]?.service_address === original.service_address, 'the moved job keeps its service address', jobs[0]?.service_address);
});

await stage('16. captured emails → gallery', async () => {
  const dir = resolve(LOGS, 'emails');
  mkdirSync(dir, { recursive: true });
  const mails = captured('email');
  const rows = mails.map((m, i) => {
    const file = `${String(i + 1).padStart(2, '0')}.html`;
    writeFileSync(resolve(dir, file), m.body?.html ?? '');
    return `<tr><td>${i + 1}</td><td>${[].concat(m.body?.to ?? []).join(', ')}</td><td><a href="${file}">${m.body?.subject ?? ''}</a></td></tr>`;
  });
  writeFileSync(resolve(dir, 'index.html'), `<!doctype html><meta charset=utf-8><title>E2E emails ${run}</title><table border=1 cellpadding=6><tr><th>#</th><th>to</th><th>subject</th></tr>${rows.join('')}</table>`);
  ok(`${mails.length} emails captured → scripts/e2e-release/.logs/emails/index.html`);
  for (const m of mails) info(`${[].concat(m.body?.to ?? []).join(',')} — ${m.body?.subject}`);
});

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
writeFileSync(resolve(LOGS, 'report.json'), JSON.stringify({ run, operatorId: S.opId, clock: S.clockId, customer: S.customerId, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed  (run ${run}, operator ${S.opId}, Stripe test clock ${S.clockId})`);
for (const f of failed) console.log(`  ✗ [${f.stage}] ${f.msg}`);
process.exit(failed.length ? 1 : 0);
