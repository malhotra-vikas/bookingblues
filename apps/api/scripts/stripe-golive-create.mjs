import Stripe from 'stripe';

/**
 * Build the LIVE-mode Stripe scaffolding for the test→live cutover: the three
 * plan products, their six prices, the Founding Member coupons, and both webhook
 * endpoints (platform + Connect).
 *
 * Creating these has NO customer impact on its own — nothing charges until
 * STRIPE_SECRET_KEY on the API is swapped to the live key. Build first, flip
 * last.
 *
 *   node scripts/stripe-golive-create.mjs             # dry-run (default)
 *   node scripts/stripe-golive-create.mjs --apply     # create
 *
 * Idempotent: products/prices/coupons/endpoints are matched on the metadata tag
 * or URL below and reused rather than duplicated, so a re-run after a partial
 * failure resumes instead of double-creating. The one exception is a webhook
 * endpoint's signing secret, which Stripe returns ONLY at creation — if an
 * endpoint already exists this prints a warning and you must read the secret
 * from the dashboard (or delete + recreate).
 *
 * Reads STRIPE_SECRET_KEY. Refuses to run against a test key unless
 * --allow-test is passed (this script is for the live cutover).
 */

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Missing STRIPE_SECRET_KEY');
  process.exit(1);
}
const APPLY = process.argv.includes('--apply');
const ALLOW_TEST = process.argv.includes('--allow-test');
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const live = key.startsWith('sk_live') || key.startsWith('rk_live');
if (!live && !ALLOW_TEST) {
  console.error('This is a TEST key. Pass --allow-test to run it against test mode anyway.');
  process.exit(1);
}

// NOTE: .env.local sets API_URL=http://localhost:3001 for local dev. Webhook
// endpoints created from that value would point at localhost and silently never
// fire, so --api-url wins over the env and a non-public URL is rejected below.
const API_URL = argOf('--api-url', process.env.API_URL ?? 'https://api.keeprsteady.com');
const stripe = new Stripe(key);
const TAG = 'keeprsteady_golive'; // metadata marker used for idempotent matching

// Plans. Amounts MUST match apps/web/lib/brand.ts PLANS (the marketing page) and
// the test-mode prices they replace.
const PLANS = [
  { slug: 'SOLO', name: 'Solo', monthly: 19_900, annual: 199_000 },
  { slug: 'CREW', name: 'Crew', monthly: 65_000, annual: 650_000 },
  { slug: 'FLEET', name: 'Fleet', monthly: 149_900, annual: 1_499_000 },
];

const FOUNDING_FIRST_MONTH_CENTS = 2_500; // $25 first month
const FOUNDING_REDEEM_BY = Math.floor(new Date('2028-01-01T00:00:00-05:00').getTime() / 1000);

// Mirrors the test-mode endpoints exactly — a cutover is the wrong moment to
// also change which events we subscribe to.
const PLATFORM_EVENTS = [
  'account.updated',
  'payment_intent.succeeded',
  'charge.refunded',
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
];
const CONNECT_EVENTS = [
  'account.updated',
  'payment_intent.succeeded',
  'charge.refunded',
  'payment_intent.payment_failed',
];

// A webhook endpoint is only useful if Stripe can actually reach it. Creating
// one against localhost/http produces an endpoint that never fires and whose
// signing secret is unrecoverable — fail loudly instead.
const apiUrlIsPublic = /^https:\/\//.test(API_URL) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(API_URL);
if (!apiUrlIsPublic) {
  console.error(
    `\nRefusing to run: API_URL="${API_URL}" is not a public https URL.\n` +
      `Webhook endpoints created from it would never receive events.\n` +
      `Pass --api-url https://api.keeprsteady.com (it overrides .env.local).`,
  );
  process.exit(1);
}

const envOut = [];
const warnings = [];
const log = (...a) => console.log(...a);
const plan = (what) => log(`  ${APPLY ? '→' : '[dry-run] would'} ${what}`);

log(`Stripe mode : ${live ? 'LIVE' : 'TEST'}`);
log(`API_URL     : ${API_URL}`);
log(`Mode        : ${APPLY ? 'APPLY (creating objects)' : 'DRY RUN (no writes)'}\n`);

// ---------------------------------------------------------------- products + prices
for (const p of PLANS) {
  log(`${p.name}`);

  const existingProducts = await stripe.products.list({ limit: 100, active: true });
  let product = existingProducts.data.find(
    (x) => x.metadata?.tag === TAG && x.metadata?.plan === p.slug.toLowerCase(),
  );
  if (!product) product = existingProducts.data.find((x) => x.name === p.name);

  if (product) {
    log(`  product exists: ${product.id}`);
  } else if (APPLY) {
    product = await stripe.products.create({
      name: p.name,
      metadata: { tag: TAG, plan: p.slug.toLowerCase() },
    });
    log(`  → created product ${product.id}`);
  } else {
    plan(`create product "${p.name}"`);
  }

  for (const [cadence, amount, interval] of [
    ['MONTHLY', p.monthly, 'month'],
    ['ANNUAL', p.annual, 'year'],
  ]) {
    const envKey = `STRIPE_PRICE_${p.slug}_${cadence}`;
    let price = null;

    if (product) {
      const prices = await stripe.prices.list({ product: product.id, limit: 100, active: true });
      price = prices.data.find(
        (x) =>
          x.unit_amount === amount &&
          x.currency === 'usd' &&
          x.recurring?.interval === interval &&
          x.recurring?.interval_count === 1,
      );
    }

    if (price) {
      log(`  ${cadence.toLowerCase()} price exists: ${price.id}`);
      envOut.push(`${envKey}=${price.id}`);
    } else if (APPLY && product) {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: amount,
        currency: 'usd',
        recurring: { interval, interval_count: 1 },
        nickname: `${p.name} ${cadence === 'MONTHLY' ? 'Monthly' : 'Annual'} (${amount / 100})`,
        metadata: { tag: TAG, plan: p.slug.toLowerCase(), cadence: cadence.toLowerCase() },
      });
      log(`  → created ${cadence.toLowerCase()} price ${price.id}  $${(amount / 100).toFixed(2)}`);
      envOut.push(`${envKey}=${price.id}`);
    } else {
      plan(`create ${cadence.toLowerCase()} price $${(amount / 100).toFixed(2)}/${interval}`);
      envOut.push(`${envKey}=<pending>`);
    }
  }
  log('');
}

// ---------------------------------------------------------------- founding coupons
log('Founding Member coupons');
const existingCoupons = await stripe.coupons.list({ limit: 100 });
for (const p of PLANS) {
  const amountOff = p.monthly - FOUNDING_FIRST_MONTH_CENTS;
  const envKey = `STRIPE_COUPON_FOUNDING_${p.slug}`;
  const found = existingCoupons.data.find(
    (c) =>
      c.metadata?.promo === 'founding_member' &&
      c.metadata?.plan === p.slug.toLowerCase() &&
      c.amount_off === amountOff &&
      c.valid,
  );
  if (found) {
    log(`  ${p.name} coupon exists: ${found.id}`);
    envOut.push(`${envKey}=${found.id}`);
  } else if (APPLY) {
    const coupon = await stripe.coupons.create({
      name: `Founding: ${p.name} $25 first mo`,
      amount_off: amountOff,
      currency: 'usd',
      duration: 'once',
      redeem_by: FOUNDING_REDEEM_BY,
      metadata: { promo: 'founding_member', plan: p.slug.toLowerCase(), tag: TAG },
    });
    log(`  → created ${p.name} coupon ${coupon.id}  -$${(amountOff / 100).toFixed(2)}`);
    envOut.push(`${envKey}=${coupon.id}`);
  } else {
    plan(`create ${p.name} coupon -$${(amountOff / 100).toFixed(2)} (first month $25)`);
    envOut.push(`${envKey}=<pending>`);
  }
}
log('');

// ---------------------------------------------------------------- webhook endpoints
log('Webhook endpoints');
const existingHooks = await stripe.webhookEndpoints.list({ limit: 100 });
for (const [label, url, events, connect, envKey] of [
  ['platform', `${API_URL}/webhooks/stripe`, PLATFORM_EVENTS, false, 'STRIPE_WEBHOOK_SECRET'],
  [
    'connect',
    `${API_URL}/webhooks/stripe/connect`,
    CONNECT_EVENTS,
    true,
    'STRIPE_CONNECT_WEBHOOK_SECRET',
  ],
]) {
  const found = existingHooks.data.find((h) => h.url === url);
  if (found) {
    log(`  ${label} endpoint exists: ${found.id} (${found.status})`);
    warnings.push(
      `${envKey}: endpoint ${found.id} already existed — Stripe only returns the signing secret at creation. Copy it from the dashboard, or delete the endpoint and re-run.`,
    );
    envOut.push(`${envKey}=<read from dashboard>`);
  } else if (APPLY) {
    const hook = await stripe.webhookEndpoints.create({
      url,
      enabled_events: events,
      ...(connect ? { connect: true } : {}),
      description: `KeeprSteady ${label} (${events.length} events)`,
      metadata: { tag: TAG },
    });
    log(`  → created ${label} endpoint ${hook.id}`);
    envOut.push(`${envKey}=${hook.secret}`);
  } else {
    plan(`create ${label} endpoint ${url} (${events.length} events${connect ? ', connect=true' : ''})`);
    envOut.push(`${envKey}=<pending>`);
  }
}

// ---------------------------------------------------------------- output
log('\n' + '='.repeat(72));
log(APPLY ? 'SET THESE ON THE RAILWAY **api** SERVICE' : 'ENV VARS THIS WOULD PRODUCE');
log('='.repeat(72));
for (const line of envOut) log(line);
log('');
log('Also on the api service:  STRIPE_SECRET_KEY=sk_live_…');
log('On the **web** service:   STRIPE_PUBLISHABLE_KEY=pk_live_…');

if (warnings.length) {
  log('\n⚠️  WARNINGS');
  for (const w of warnings) log(`  - ${w}`);
}
if (!APPLY) log('\nDry run only — nothing was created. Re-run with --apply.');
