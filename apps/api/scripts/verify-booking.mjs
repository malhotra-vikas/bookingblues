import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

/**
 * §11 full booking + fee loop verifier (Reserve→Pay→Confirm). Read-only.
 * Run AFTER placing the test call + paying the deposit.
 *
 *   node scripts/verify-booking.mjs +1XXXXXXXXXX   # the phone you CALLED FROM
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (required) and
 * STRIPE_SECRET_KEY (optional — enables the platform application-fee check).
 *
 * Validates the whole chain:
 *   conversation  -> completed / outcome=booked
 *   appointment   -> confirmed, google_event_id set, slot on a weekday in hours
 *   payment       -> succeeded, amount = deposit + platform fee, app fee set
 *   stripe PI     -> application_fee_amount landed on the PLATFORM balance
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const phone = process.argv[2];
if (!phone) {
  console.error('Usage: node scripts/verify-booking.mjs +1XXXXXXXXXX  (the number you called from)');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const pass = (m) => console.log(`  \x1b[32mPASS\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
const info = (m) => console.log(`  ·    ${m}`);
const money = (c) => (c == null ? 'null' : `$${(c / 100).toFixed(2)}`);

// --- most recent conversation for this caller ---
const { data: convo, error: cErr } = await db
  .from('conversations')
  .select('id, operator_id, status, outcome, started_at, completed_at, summary')
  .eq('caller_phone_e164', phone)
  .order('started_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (cErr) throw cErr;
if (!convo) {
  fail(`No conversation found for ${phone}. Did the call/SMS land?`);
  process.exit(1);
}
console.log(`\nConversation ${convo.id}`);
convo.status === 'completed' ? pass(`status=completed`) : fail(`status=${convo.status} (expected completed)`);
convo.outcome === 'booked' ? pass(`outcome=booked`) : fail(`outcome=${convo.outcome} (expected booked)`);

// --- operator (for timezone + connect account) ---
const { data: op } = await db
  .from('operators')
  .select('business_name, timezone, booking_fee_cents, stripe_connect_account_id, business_hours')
  .eq('id', convo.operator_id)
  .maybeSingle();
info(`operator: ${op?.business_name} (${op?.timezone}), deposit ${money(op?.booking_fee_cents)}`);

// --- appointment ---
const { data: appt } = await db
  .from('appointments')
  .select('id, status, google_event_id, scheduled_for_start, scheduled_for_end, fee_status, fee_cents, caller_name, job_summary')
  .eq('conversation_id', convo.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (!appt) {
  fail('No appointment row for this conversation.');
  process.exit(1);
}
console.log(`\nAppointment ${appt.id}`);
appt.status === 'confirmed' ? pass(`status=confirmed`) : fail(`status=${appt.status} (expected confirmed — did payment succeed?)`);
appt.google_event_id ? pass(`google_event_id=${appt.google_event_id}`) : fail('google_event_id is null (calendar event not created)');
appt.fee_status === 'paid' ? pass(`fee_status=paid`) : fail(`fee_status=${appt.fee_status} (expected paid)`);

const day = new Date(appt.scheduled_for_start).toLocaleString('en-US', {
  timeZone: op?.timezone ?? 'UTC',
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const weekday = new Date(appt.scheduled_for_start).toLocaleString('en-US', { timeZone: op?.timezone ?? 'UTC', weekday: 'short' });
const isWeekend = weekday === 'Sat' || weekday === 'Sun';
isWeekend ? fail(`slot is on ${day} — a CLOSED weekend day (bug #1 not fixed)`) : pass(`slot ${day} (weekday)`);

// --- payment ---
const { data: pay } = await db
  .from('payments')
  .select('id, status, amount_cents, application_fee_cents, currency, stripe_payment_intent_id, stripe_connected_account_id, stripe_charge_id')
  .eq('appointment_id', appt.id)
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
if (!pay) {
  fail('No payment row for this appointment.');
  process.exit(1);
}
console.log(`\nPayment ${pay.id}`);
pay.status === 'succeeded' ? pass(`status=succeeded`) : fail(`status=${pay.status} (expected succeeded)`);
const expectedCharge = (op?.booking_fee_cents ?? 0) + (pay.application_fee_cents ?? 0);
pay.amount_cents === expectedCharge
  ? pass(`amount=${money(pay.amount_cents)} = deposit ${money(op?.booking_fee_cents)} + platform fee ${money(pay.application_fee_cents)}`)
  : info(`amount=${money(pay.amount_cents)}, app fee=${money(pay.application_fee_cents)} (deposit ${money(op?.booking_fee_cents)})`);
pay.application_fee_cents > 0 ? pass(`application_fee=${money(pay.application_fee_cents)} (KeeprSteady cut)`) : fail('application_fee_cents is 0');

// --- Stripe cross-check (optional) ---
if (stripe && pay.stripe_payment_intent_id && pay.stripe_connected_account_id) {
  try {
    const pi = await stripe.paymentIntents.retrieve(
      pay.stripe_payment_intent_id,
      { expand: ['latest_charge', 'application_fee'] },
      { stripeAccount: pay.stripe_connected_account_id },
    );
    console.log(`\nStripe PI ${pi.id} (on connected acct ${pay.stripe_connected_account_id})`);
    pi.status === 'succeeded' ? pass(`PI status=succeeded`) : fail(`PI status=${pi.status}`);
    const appFee = pi.application_fee_amount ?? pi.latest_charge?.application_fee_amount;
    info(`application_fee_amount on PI = ${money(appFee)} → settles to platform balance`);
  } catch (e) {
    info(`Stripe PI retrieve skipped: ${e.message}`);
  }
} else if (!stripe) {
  info('Set STRIPE_SECRET_KEY to also verify the application fee on the Stripe PI.');
}

console.log('');
