# Stripe test → live cutover

Env-var-by-env-var runbook for flipping production from Stripe **test mode** to
**live mode**. Written 2026-08-12 against the actual state of
`acct_1TUVtIBrlSqhHprp` ("bookingblues") and the Railway `production`
environment.

**The governing fact:** Stripe test and live are two isolated parallel universes
on one account. Nothing carries over — not customers, not subscriptions, not
payment methods, not Connect accounts, not prices, not webhook secrets. There is
no test→live migration path, and there is no way to charge a test-mode card in
live (they are fake numbers). Everything below exists because of that.

---

## 0. Pre-flight state (verified 2026-08-12)

| Check | Result |
|---|---|
| Live account `charges_enabled` | ✅ true |
| Live account `payouts_enabled` | ✅ true |
| Live `details_submitted` | ✅ true |
| Live `requirements.currently_due` | ✅ empty |
| `card_payments` / `transfers` capability | ✅ active / active |
| Live products / prices / coupons / webhooks | ⬜ **none — clean slate** |
| Live connected accounts | ⬜ none (3 exist in test) |

The live account is fully activated. The work is purely creating the live-mode
objects and repointing env.

### Credential note

`stripe login`'s CLI key is a **restricted** live key (`rk_live_…`, expires
2026-08-26) with **read-only** scope — it cannot create products, prices,
coupons, or webhook endpoints:

```
more_permissions_required: ... does not have the required permissions ...
Enabling "Features Write" ('feature_write'), "Products Write" ('product_write')
```

Two ways to unblock, pick one:

- **Preferred** — create `.env.golive.local` in the repo root containing just:

  ```
  STRIPE_SECRET_KEY=sk_live_…
  ```

  Copy the key from Stripe → Developers → API keys, with the dashboard toggled
  to **live**. You need this key for Railway anyway.

  `.env.golive.local` is gitignored by the `.env.*.local` rule, and keeping it
  separate from `.env.local` means local dev and the other scripts keep using
  the **test** key — only the cutover script sees live. Delete it when done.

- Or grant the CLI key write scope at
  `dashboard.stripe.com → Developers → API keys → (the CLI key) → Edit`:
  Products, Prices, Coupons, and Webhook Endpoints → **Write**.

---

## 1. Create the live objects

Nothing here charges anyone. These objects are inert until the API's
`STRIPE_SECRET_KEY` is swapped in step 3 — **build first, flip last**.

```bash
cd apps/api
# dry-run
node -r dotenv/config scripts/stripe-golive-create.mjs \
  --api-url https://api.keeprsteady.com dotenv_config_path=../../.env.golive.local
# create
node -r dotenv/config scripts/stripe-golive-create.mjs --apply \
  --api-url https://api.keeprsteady.com dotenv_config_path=../../.env.golive.local
```

> `--api-url` is **required in practice**: `.env.local` sets
> `API_URL=http://localhost:3001` for local dev, and webhook endpoints created
> from that would point at localhost, never fire, and burn their unrecoverable
> signing secret. The script refuses any non-public https URL rather than let
> that happen.

Creates, idempotently:

**Products + prices** (amounts mirror `apps/web/lib/brand.ts` and the test-mode
prices they replace):

| Plan | Monthly | Annual |
|---|---|---|
| Solo | $199.00 (`19900`) | $1,990.00 (`199000`) |
| Crew | $650.00 (`65000`) | $6,500.00 (`650000`) |
| Fleet | $1,499.00 (`149900`) | $14,990.00 (`1499000`) |

**Founding Member coupons** — `duration: once`, `redeem_by` 2027-12-31 (end of day ET; extended 2026-10-26 — Stripe cannot extend a coupon, so these are new coupons), sized so
the first month costs $25: Solo −$174.00, Crew −$625.00, Fleet −$1,474.00.

**Webhook endpoints** — event lists copied verbatim from test mode; a cutover is
the wrong moment to also change what we subscribe to.

| Endpoint | URL | Events |
|---|---|---|
| Platform | `https://api.keeprsteady.com/webhooks/stripe` | 10 (checkout + subscription + invoice lifecycle) |
| Connect (`connect: true`) | `https://api.keeprsteady.com/webhooks/stripe/connect` | 4 (`account.updated`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`) |

> ⚠️ Stripe returns a webhook **signing secret only at creation time**. The
> script prints it once. If an endpoint already exists it cannot re-read the
> secret — take it from the dashboard, or delete and recreate the endpoint.

The script prints a ready-to-paste block of every env var it produced.

---

## 2. Live-mode dashboard settings (manual, not scriptable)

- [ ] **Connect** → enable/confirm the platform profile in **live**, and accept
      **loss liability** (this was done in test; live is separate).
- [ ] **Public business name / statement descriptor** — currently the live
      dashboard display name is **`bookingblues`**, which is what shows on a
      subscriber's card statement. Change to **KeeprSteady**.
- [ ] **Customer Portal** → configure in live (cancel / update payment method /
      switch plan). The portal has separate test and live configuration; if it's
      unconfigured in live, `GET /v1/billing/portal-session` will fail.
- [ ] Branding (logo, colors) for Checkout + the portal.

---

## 3. Flip the env vars (this is the cutover moment)

Railway project **BookingBlues**, environment **production**.

### `api` service

| Var | From (test) | To (live) |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | test `whsec_…` | live platform `whsec_…` (step 1) |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | test `whsec_…` | live Connect `whsec_…` (step 1) |
| `STRIPE_PRICE_SOLO_MONTHLY` | `price_1TxXtl…JxAIlRmT` | live price |
| `STRIPE_PRICE_SOLO_ANNUAL` | `price_1TxXtl…hUDQHLny` | live price |
| `STRIPE_PRICE_CREW_MONTHLY` | `price_1Tc8QU…QF9m5o72` | live price |
| `STRIPE_PRICE_CREW_ANNUAL` | `price_1Tc8Qq…9LrsoHG1` | live price |
| `STRIPE_PRICE_FLEET_MONTHLY` | `price_1Tc8RS…P8HxqnMv` | live price |
| `STRIPE_PRICE_FLEET_ANNUAL` | `price_1Tc8RS…8XXA3Knw` | live price |
| `STRIPE_COUPON_FOUNDING_SOLO` | `2kWJHxfM` | live coupon |
| `STRIPE_COUPON_FOUNDING_CREW` | `iphMZCBZ` | live coupon |
| `STRIPE_COUPON_FOUNDING_FLEET` | `lkxAlQsp` | live coupon |

Unchanged: `PLATFORM_TAKE_RATE_BPS*` (1000 / solo 1500 / crew 1200 / fleet 1000),
`MIN_PLATFORM_FEE_CENTS` (100). Promo: `PROMO_FOUNDING_ENDS_AT=2028-01-01T00:00:00-05:00`, live coupons Solo `hUqyBXRv` / Crew `d7wuxF7i` / Fleet `ucyHXvie`.

### `web` service

| Var | From | To |
|---|---|---|
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_…` | `pk_live_…` |

Then redeploy both services.

---

## 4. Existing operator rows

31 operators exist, all created against test mode. 14 carry test-mode Stripe IDs
that resolve to nothing under live keys — every Stripe call for those rows would
throw "no such customer". **Nobody has ever been charged real money** (test
cards only).

Decision (2026-08-12): **comp all 31** onto a 180-day trial and clear the dead
linkage, rather than stranding them.

```bash
cd apps/api
node -r dotenv/config scripts/comp-operators-for-golive.mjs \
  dotenv_config_path=../../.env.local --until 2027-02-08          # dry-run
node -r dotenv/config scripts/comp-operators-for-golive.mjs --apply \
  dotenv_config_path=../../.env.local --until 2027-02-08
```

Sets `subscription_status='trialing'` + `trial_ends_at` and nulls
`stripe_customer_id` / `_subscription_id` / `_price_id` /
`_connect_account_id` (+ resets the Connect capability flags). No Stripe object
is involved — `trialing` with no subscription is an already-supported state
(`sales.service.ts` creates rep-originated operators exactly that way), and
every gate in the app reads `subscription_status IN ('trialing','active')`.

`current_period_*` is deliberately nulled so the usage meter falls back to a
calendar month; a 180-day "billing period" would break the per-month
conversation limit.

**Connect consequence:** any operator who wants to collect deposits must re-run
Connect Express onboarding in live — real KYC, not the `000-00-0000` test SSN.
Unavoidable; test `acct_…` IDs don't exist in live.

---

## 5. Verify

- [ ] `GET https://api.keeprsteady.com/v1/health` → 200.
- [ ] `/pricing` shows $199 / $650 / $1,499 and the Founding banner (if promo on).
- [ ] Stripe dashboard is in **live** mode → Checkout a real card on the cheapest
      plan → subscription appears live, `operators` row gets the live
      `cus_`/`sub_`, `subscription_status='trialing'` (7-day trial), and
      `plan`/`plan_cadence` derive from the live price ID.
- [ ] **Refund/cancel that test purchase** immediately unless it's a real one.
- [ ] Platform webhook: Stripe → Developers → Webhooks → live platform endpoint
      shows 2xx deliveries.
- [ ] Connect: run one operator through live Express onboarding → `account.updated`
      lands on the Connect endpoint → `stripe_connect_charges_enabled` flips true.
- [ ] Booking-fee loop: a real deposit charge → `payment_intent.succeeded` on the
      **Connect** endpoint → `payments.status='succeeded'`,
      `appointments.fee_status='paid'`, application fee on the platform balance.

## 6. Rollback

Set the `api` + `web` Stripe vars back to the test values in the table in §3 and
redeploy — the live objects are left in place, harmless. Anything actually
charged in live must be refunded in live; that does not roll back with env.
Operator rows changed in §4 are not restored by an env rollback either.
