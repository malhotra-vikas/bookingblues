# Manual Test Script — run on PROD (keeprsteady.com)

Run first thing after deploying the 2026-06-23 session work. Tests everything
changed: A2P affirmative IVR + consent, dark-mode removal, terms latency fix,
forgot/reset password, signup email-confirm landing, sales role (#4), admin
login-as (#5), usage metering, pricing copy.

**Target = production.** Web: `https://keeprsteady.com`. API: `https://api.keeprsteady.com`.
All paths below are on `https://keeprsteady.com` unless noted.

Legend: **[web]** browser-only · **[phone]** needs a real call · **[admin]** needs admin login.

**Intro / test account:** `malhotra.vikas+1@gmail.com` — this is BOTH the admin
AND an operator (Zeus Electrical, +1 385-317-1322). Use it for admin (§7–§8),
operator dashboard (§6), and as the "login as" target. Second operator:
`malhotra.vikas+2@gmail.com` (+1 541-692-8352). For signup/reset tests use fresh
`malhotra.vikas+test1@gmail.com`-style aliases (all deliver to your inbox).

> ⚠️ This is prod data. Stripe is in **test mode** (BookingBlues account) — use
> test card `4242 4242 4242 4242`. **A2P 10DLC campaign is APPROVED (2026-06-25) —
> SMS now delivers for real**, so §9 can be judged by actually receiving the text
> (Twilio logs / DB rows still corroborate). Clean up test rows at the end.

---

## 0. Pre-flight (do these BEFORE testing)
1. **Deploy is live** — latest web + API deployed to prod.
2. **API reachable through Cloudflare:** `curl -i https://api.keeprsteady.com/v1/health`
   → **JSON 200** `{"status":"ok",...}`. If you get an HTML "Just a moment" 403,
   Cloudflare is still challenging the API (the `api` DNS record must be grey /
   DNS-only, or add a WAF skip). Nothing else will work until this is clean.
3. **Migrations applied to prod**, in order:
   `20260622000001`, `20260623000001`, `20260623000002`, `20260623000003`.
4. **Supabase (prod) → Auth → URL Configuration → Redirect URLs** includes
   `https://keeprsteady.com/auth/callback` (or `https://keeprsteady.com/**`).
5. Prod env: `NEXT_PUBLIC_APP_URL=https://keeprsteady.com`,
   `NEXT_PUBLIC_API_URL=https://api.keeprsteady.com`, `APP_URL=https://keeprsteady.com`.
6. **Email templates (item 1):** Supabase dashboard → Auth → Emails → confirm
   "Confirm signup" / "Reset Password" / "Magic Link" say **KeeprSteady**, not
   BookingBlues. (Dashboard change, not code.)

---

## 1. Dark mode removed — [web]
1. Visit `/`, `/pricing`, `/login`, and (signed in) `/dashboard`, `/settings`.
2. **Expect:** light everywhere; **no** sun/moon toggle in any header.
3. Set your OS to dark mode, hard-reload `/`. **Expect:** still light.

## 2. Pricing copy — [web]
1. `/pricing`, **Monthly** tab → under each price: *"Prefer annual? $X/yr — 2 months
   free vs. monthly"* (no longer reads as if monthly gives 2 free months).
2. **Annual** tab → *"$X/yr — save $Y"*. Solo 490/98, Crew 6500/1300, Fleet 14990/2998.

## 3. Signup → email confirm → onboarding — [web]
1. `/signup` with `malhotra.vikas+test1@gmail.com`, business name, US phone, check
   consent → **Create account**.
2. **Expect:** "We sent a confirmation link… click it to verify and continue to setup."
3. Open email → click confirm link.
4. **Expect:** lands **logged-in on `/onboarding`** (NOT the home page).
5. The email should be branded **KeeprSteady** (item 1 / §0.6).

## 4. Login + Forgot/Reset password — [web]
1. `/login` → **Expect** a "Forgot password?" link.
2. Click → `/forgot-password`, enter the email → **Send reset link** → confirmation msg.
3. Open reset email → click link → **Expect** `/reset-password` "Set a new password"
   form. Set new password → redirected to `/dashboard`.
4. Sign out, sign in with the **new** password → works.
5. Negative: open `/reset-password` directly → **Expect** "Link expired".

## 5. Terms re-accept latency — [web]
1. If a re-accept is pending (or after a `TERMS.version` bump deploy), load `/dashboard`
   → redirected to `/accept-terms`.
2. Check the box → **Accept and continue** → **Expect** the modal closes and you
   land on `/dashboard` **immediately** (no multi-second hang).

## 6. Dashboard + Usage metering — [web]
1. Sign in as `malhotra.vikas+1` → `/dashboard`.
2. **Expect:** metric cards load — **no 403** (if 403 → Cloudflare, §0.2) and **no 404**.
3. **Expect:** a **"Conversations this billing period — X / Y"** meter (bar + reset date).
   - Y = plan limit (Solo 80 / Crew 500 / Fleet 1500); blank if no plan.
   - If `current_period_*` isn't synced yet, the window falls back to the calendar
     month (still shows a count). It populates on the next Stripe subscription webhook.

## 7. Sales role #4 — [admin] + [web]
1. As admin (`+1`) → `/admin` → **Sales reps** → `/admin/sales`.
2. Promote a user: email + their Slack member ID (`U…` that #bb-leads "Claim" records)
   → **Promote to sales** → "Promoted …".
3. Verify: that user's `app_metadata.role='sales'` and a `sales_slack_links` row exists.
4. Log in as that sales user:
   - **Expect:** hitting `/dashboard` redirects to **`/sales`**.
   - `/sales` lists leads where `lead_claims.claimed_by_slack_user_id` = their Slack id
     (claim one in #bb-leads first if empty).
   - Lead with an operator → **"Login as"** → reason → opens a tab logged in as them.
5. **Security scope check:** `POST /v1/sales/operators/<unclaimed-operator-id>/impersonate`
   → **403**.
6. As admin: `DELETE /v1/admin/sales/:userId` → role + link removed; user loses `/sales`.

## 8. Admin "login as" #5 — [admin]
1. As admin → `/admin/operators/<id>` → **Actions → Impersonate** → reason → Generate.
2. **Expect:** new tab logged in as that operator (`?impersonating=1`).
3. Confirm an `audit_log` row `operator.impersonate`.

## 9. A2P affirmative voice IVR + consent — [web] / [phone]
1. **[web]** `/messaging/opt-in`: name + mobile + **unchecked** consent box + full
   disclosure. Submit valid US number → success; `sms_consents` `source='web_opt_in'`
   row written. Consent unchecked → blocked.
2. **[web]** `/messaging`: quotes the exact spoken disclosure incl. "press 1, or say yes".
3. **[phone]** Call +1 385-317-1322:
   - **Expect:** hear the disclosure + "to get that text now, press 1, or say yes."
   - **Press 1** → opening SMS attempted (Twilio Console message logs / new `messages`
     row / `sms_consents` `source='voice_ivr'`).
   - Call again, **hang up / no input** → **no SMS** attempted.
   - SMS **delivery** stays blocked until A2P approval — judge by the attempt/logs.

## 10. Webhooks — [phone]/Stripe
1. With §0.2 clear, the live call in §9 reaching the API confirms Twilio webhooks
   work through Cloudflare (DNS-only).
2. A Stripe test event (e.g., trigger a subscription update) should hit
   `/webhooks/stripe` and update the operator — and now populate `current_period_*`.

---

## 11. Full SMS booking flow E2E — the value loop — [phone]/[web]/Stripe
The critical path (CLAUDE.md §9.2–9.5): missed call → SMS → AI books on Google
Calendar → collects the booking fee → platform fee lands on our balance. This is
the "Monetization completeness" verification (PROGRESS.md). A2P is approved, so SMS
delivers for real.

**Pre-reqs — the operator must satisfy all 4 fee-eligibility gates (CLAUDE.md §9.5):**
1. `booking_fee_enabled = true` + `booking_fee_cents` set (Settings or onboarding §6).
2. `subscription_status IN (trialing, active)`.
3. Stripe Connect `charges_enabled = true` AND `payouts_enabled = true` — finish
   Connect Express onboarding (test mode: SSN `000-00-0000`, test values). Until
   both flags are true the bot books WITHOUT a fee (verify that path too).
   Use Zeus Electrical (`+1`, Solo → 10%) or a fresh operator.

**Flow:**
1. **Trigger** — either call the operator's mobile (carrier-forwards → Twilio →
   voice greeting + opening SMS), or text the Twilio number directly. Opening SMS
   should arrive (category-specific, names the business).
2. **Converse** — reply as a homeowner with an in-category job. Bot asks the
   category vetting questions, captures the job. Watch live in the `#convos` Slack
   thread (every caller/bot SMS echoes there).
3. **Slots** — bot calls `check_availability` and proposes real free slots from the
   operator's Google Calendar, within business hours + operator timezone.
4. **Book** — accept a slot → `book_appointment`:
   - A **Google Calendar event** is actually created (check the calendar — right
     time, timezone, caller as attendee if email given).
   - `appointments` row: `status=confirmed`, `google_event_id` set,
     `scheduled_for_*` correct.
5. **Fee** — bot sends a Stripe Checkout link (`request_payment_link` →
   `createBookingFeeCheckout` on the **connected** account). Pay with
   `4242 4242 4242 4242`.
6. **Settle** — `payment_intent.succeeded` hits **`/webhooks/stripe/connect`** →
   `payments.status='succeeded'`, `appointments.fee_status='paid'`.
7. **Confirm** — confirmation **SMS** to caller + operator, and **email** (Resend)
   to operator (+ caller if email captured).

**Verify the money — on-top model (Solo 10% / Crew 15% / Fleet 20%):** for a $50
Solo deposit the caller is charged **$55**, our `application_fee` is **$5**, the
operator keeps the **$50** (less Stripe processing).
- `payments` row: `amount_cents` = deposit + platform fee (= **5500**),
  `application_fee_cents` = platform fee (= **500**), `status=succeeded`,
  `stripe_connected_account_id` = the operator's acct.
- **Stripe platform balance** (BookingBlues acct): the **application fee** ($5)
  lands here — this is "seeing the platform fee" on the platform side.
- **Stripe connected account**: the full charge ($55) appears; operator is MoR;
  statement descriptor = operator business name.
- **Admin**: `/admin/operators/:id` dossier fee total + payments list show the
  `application_fee`; `/admin/metrics` fee-revenue MTD includes it.
- ⚠️ **Operator dashboard "Fees collected"** currently sums `application_fee_cents`
  (= OUR cut), which is wrong for the on-top model — the operator keeps the deposit,
  not our fee. **Expected finding to fix:** it should show the operator's deposit
  revenue, not the platform fee. Note what it displays.

**Also check the no-fee path:** an operator failing any gate (e.g. Connect not
finished) → bot books the appointment but does NOT send a payment link, no
`payments` row. Confirm it degrades cleanly rather than erroring.

---

## Reset / cleanup
- Delete test `sms_consents`, `conversations`, and the test `auth.users` created in §3/§9.
- Delete test `appointments` + `payments` and remove the test Google Calendar events created in §11.
- Refund the test booking-fee charge in Stripe (test mode) if you want a clean balance.
- Demote any test sales users (§7.6).
- Revert any `TERMS.version` bump used for §5.
