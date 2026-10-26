# Manual test — 2026-06-30 (emergency charges, stale-conversation, dashboard, short links)

Covers the last few commits: §11 booking+fee loop, emergency charges (17b/c/d),
post-payment address collection, stale-conversation auto-close + manual resolve,
dashboard period filters + booked-metric + fee display, conversation detail view,
and short payment/calendar links.

**Test rig:** call/text **from your phone** (caller •••9213) to operator **cd**
(`malhotra.vikas+cd@gmail.com`, Chicken Dinner, Twilio **+1 424-425-3663**).
Prod, Stripe **test mode**, test card `4242 4242 4242 4242` (any future expiry/CVC/ZIP).
`.env.local` points at PROD — verifier scripts read/write prod.

Note results inline (✅ / ❌ + what you saw).

---

## 0. Pre-flight (do once, before testing)

- [ ] **Push + deploy** api + web. Wait for both green on Railway.
- [ ] **Migrations applied** (Railway pre-deploy `pnpm db:migrate`): `20260629000002`
      (service_address), `20260629000003` (allow_unpaid_emergency_booking +
      collect_payment_on_site). Confirm columns exist (or just that deploy ran clean).
- [ ] **Cron #3 — conversation close-stale** exists + deployed, hourly:
      `curl -fsS -X POST "$API_URL/v1/internal/conversations/close-stale" -H "X-Cron-Secret: $CRON_SHARED_SECRET"`
      → returns `{"closed":N}`. (Booking-holds cron already running.)
- [ ] **Short-link routes live** (new code):
      `curl -sI https://api.keeprsteady.com/cal/test` → `302` (not 404).
      `curl -s -o /dev/null -w "%{http_code}" -X POST https://api.keeprsteady.com/v1/internal/conversations/close-stale` → `403` (route exists, needs secret).
- [ ] **cd Settings:** Booking fee **$250** on, Emergency visit fee set (e.g. **$150**),
      business hours Mon–Fri 9–5, Stripe payouts ✓. Leave the new
      **"allow booking without payment in life-safety emergencies"** toggle **OFF** for §3a, ON for §3b.
- [ ] **Reset the test conversation** before each run:
      `node apps/api/scripts/reset-test-conversation.mjs +1YOURNUMBER malhotra.vikas+cd@gmail.com`

---

## 1. Standard booking + fee loop (regression)

1. Call **+1 424-425-3663**, press 1 / say "yes" to consent.
2. Routine job ("replace a kitchen faucet next week"), ZIP **08821** (radius), give name.
3. Ask for the **weekend** → expect: bot says closed Sat/Sun, offers weekday slots.
4. Agree to a **weekday** slot.
   - [ ] Bot texts **one** SMS: "Almost done, {name}! …held for 30 min. Pay the $250 booking fee…"
   - [ ] The **payment link is short** (`api.keeprsteady.com/pay/…`) and **tappable** (not broken).
5. Tap link → pay with test card.
   - [ ] Lands on **/booking/result** showing **"✅ You're all set!"** (NOT a 404 / "page not available").
   - [ ] You get a **confirmation SMS** that asks for the **full property address**.
   - [ ] The confirmation's **calendar link is short** (`api.keeprsteady.com/cal/…`) and **tappable**;
         tapping it opens the event (add-to-calendar).
6. Reply with a full address (street, unit, city, ZIP).
   - [ ] Bot acknowledges ("Perfect — got your address…").
   - [ ] **Google Calendar event** has the address in its **location**.
7. Verify DB: `node apps/api/scripts/verify-booking.mjs +1YOURNUMBER`
   - [ ] conversation completed/booked, appointment confirmed + google_event_id,
         payment succeeded, amount = deposit + platform fee, app fee on platform balance.

---

## 2. Address-collection robustness

- [ ] **Don't reply with the address** after paying. Confirm the conversation stays
      **open** (status `awaiting_caller`) — i.e. the stale-close does NOT close a booked
      conversation that's missing its address. (Run the close-stale cron curl; it should
      report it did NOT close this one. Booked-without-address is intentionally skipped.)
- [ ] On the dashboard, that conversation is still open with a **"Mark resolved"** button.

---

## 3. Emergency charges (17b/c/d)

### 3a. Serviceable emergency → deposit + emergency fee (toggle OFF)
1. Reset convo. Settings: unpaid-emergency toggle **OFF**.
2. Call → describe an **urgent but serviceable** job (e.g. "burst pipe, water everywhere,
   please come today") + give ZIP/name + agree to a slot.
   - [ ] **Operator's personal phone gets an emergency alert SMS** (non-blocking — the AI keeps going).
   - [ ] Bot proceeds to book and texts a payment link for **deposit + emergency fee**
         (e.g. $250 + $150 = **$400** operator take, + platform fee on top).
3. Pay → confirmed.
   - [ ] `verify-booking.mjs` shows fee_cents = **deposit + emergency** (operator take).

### 3b. Immediate danger + operator allows unpaid (toggle ON)
1. Reset convo. Settings: unpaid-emergency toggle **ON**.
2. Call → **life-safety** wording ("I smell gas" / "sparks from the panel") + give name + slot.
   - [ ] Bot first gives a **safety instruction** (leave home / call 911 or gas co).
   - [ ] Operator phone alert fires.
   - [ ] Bot **books without taking payment** (no payment link), confirms the slot.
3. Check **dashboard → Upcoming appointments**:
   - [ ] The appointment shows an amber **"collect on site"** badge (+ the amount).
4. Check the **calendar invite** body:
   - [ ] Contains **"⚠ COLLECT $X ON SITE — emergency booking, not prepaid."**

### 3c. Immediate danger + operator does NOT allow unpaid (toggle OFF)
1. Reset convo. Settings: toggle **OFF**.
2. Repeat 3b's danger wording.
   - [ ] Bot still alerts + gives safety instruction, but **charges** (deposit + emergency fee)
         via the normal payment link (no unpaid booking).

---

## 4. Stale-conversation auto-close + manual resolve

- [ ] **Manual resolve:** on the dashboard, click **"Mark resolved"** on an open
      conversation → it can take an **optional address** → row flips to `completed`.
      If you enter an address for a booked one, confirm it lands on the calendar invite.
- [ ] **Auto-close:** the close-stale cron closes conversations idle >24h
      (`{"closed":N}`), but **never** an `escalated` one and **never** a booked one
      still missing its address. (Hard to wait 24h live — trust the unit logic + the
      cron returning 0 on fresh data; spot-check an old idle convo if you have one.)

---

## 5. Dashboard

- [ ] **Booked metric** matches reality: equals **confirmed + completed appointments**
      (the earlier "2 appts but Booked: 1" bug is fixed).
- [ ] **Fees collected** shows the **operator's deposit total** (e.g. $250/$400 per booking),
      NOT the $37.50 platform cut.
- [ ] **Period filters**: toggle **This month / This quarter / This year / Custom**
      (with from/to dates) → the stat numbers + "Stats for …" label update for the window.
- [ ] **Per-appointment fee** column shows the $ amount + status (or "collect on site").

---

## 6. Conversation detail view

- [ ] Click a conversation's number in **Recent conversations** → opens
      `/conversations/<id>` with the **full transcript** (caller / AI / system bubbles,
      status, outcome, summary) + a back link.

---

## 7. Operator email

- [ ] The booking-summary email to the operator shows **Fee: $250.00 (paid)** (or the
      emergency total), NOT "No fee", for a paid booking.

---

## Verifier scripts (read-only unless noted)
- `verify-booking.mjs +1<caller#>` — full booking+fee chain
- `verify-service-area.mjs <op-email> <zip>` — service-area / radius
- `verify-consent-flow.mjs +1<caller#>` — consent + conversation
- `reset-test-conversation.mjs +1<caller#> <op-email>` — start a clean run (writes)
