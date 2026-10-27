# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Resume brief — 2026-10-27 (after the 2026-10-26 session)

**Where we are:** **Production is on LIVE Stripe** (cut over 2026-10-26). All code is committed,
pushed and deployed (latest: special pricing `d062d74` + docs). Migration history repaired (32/32).
An overnight **audit report** is in `docs/AUDIT-2026-10-27.md`; read it with Vikas and pick what to fix.

### Done 2026-10-26
- **Stripe live cutover.** Live prices, the 3 live Founding coupons (`hUqyBXRv`/`d7wuxF7i`/`ucyHXvie`),
  webhook endpoints (recreated, secrets in gitignored `.env.golive.local`) and the live Customer
  Portal are all set. Railway `api` env flipped to live. Verified: `/v1/plans` serves live price IDs,
  and a `+livetest` signup created a **live** customer + checkout with the Founding coupon.
  Statement descriptor `KEEPRSTEADY`. Rollback = put test values back on Railway (see `docs/STRIPE_GO_LIVE.md`).
- **33 existing operators comped**: 365-day trial to **2027-10-26**, test-mode Stripe IDs cleared
  (backup of the old values: `~/bookingblues-backups/operators-stripe-backup-2026-10-26.json`, not in repo). Plan: delete the test ones later.
  ⚠️ Check each one first — some (e.g. Nick Thielen) may be real leads.
- **Founding promo extended to end of 2027** (`PROMO_FOUNDING_ENDS_AT=2028-01-01T00:00:00-05:00`);
  banner shows "Ends Dec 31, 2027"; onboarding plan cards now show $25 first month.
- Dashboard "Plan status: none" → "trial not started · Start free trial".
- **NEW: Admin special pricing per operator** (`/admin/operators/:id` → Special pricing card). See PROGRESS.
- **Migrations are NOT auto-applied on deploy** (the `pnpm db:migrate` pre-deploy never existed).
  `truck_count` had been missing on prod since July — applied now. Always `supabase db push` before
  pushing code that needs a migration (CLAUDE.md §14).
- The **dialer** is a separate project (`/Volumes/SSD/builderspace/dialer`), worked on in its own window.

### Tomorrow — pick up here
1. **Vikas's manual tests:**
   a. Finish the `+livetest` live checkout (Solo monthly, real card, $0 today) → I verify the live
      sub is `trialing` with the coupon, the `operators` row has live `cus_`/`sub_`, the platform
      webhook got 2xx → then cancel via the billing portal (tests the portal + cancel webhook).
   b. Special pricing: as admin set Solo · Monthly · $50 · 6 months on operator
      `17877299-9d0d-4c57-a6c3-0b259637e453` → `+livetest` onboarding card shows $50/mo → checkout
      shows $50 after trial. Then Remove.
2. **Stripe dashboard leftovers (live):** shortened descriptor prefix still `BOOKINGBLU` → change to
   KEEPRSTEADY; add a support email; Connect loss-liability confirmation.
3. **Review `docs/AUDIT-2026-10-27.md`** and choose fixes.
4. Still open from before: Google OAuth verification status (reply to Google's 07-17 AI/ML
   questionnaire sent?), IVR consent real-call test, the 2026-06-30 pending prod tests.

### Gotchas
- `.env.local` → **PROD** Supabase + **TEST** Stripe key (stale test price IDs — Solo points at an
  inactive $49 price). `.env.golive.local` holds the LIVE key + live webhook secrets.
- Use Node 22 for scripts: `export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"`.
- Integration specs in `apps/api/test/` run against **prod** Supabase — don't run them casually.
- Local `next build` needs `NODE_ENV=production` (`.env.local` sets development).

---

## Resume brief — 2026-07-16 (after the 2026-07-15 session, Mac restarted)

**Where we are:** shipping growth + monetization features. **All CODE is committed +
deployed to Railway** (latest `f3ba94b "AEO Deploy"`, prod verified live). Working tree
has **only DOCS uncommitted** (safe across restart): `CLAUDE.md`, `docs/PROGRESS.md`,
`docs/SEO_AEO.md` (new), `docs/manual-test-2026-06-30.md` (old untracked). → **First thing:
`git add` + commit those docs** (user reviews/commits themselves per usual).

### What shipped & deployed this session (all live on prod)
- **Founding Member promo** — $25 first month on monthly plans, 7-day trial then regular
  price. Per-plan Stripe `duration:once` coupons (TEST mode: Solo `Wv2sUiy2`, Crew
  `iphMZCBZ`, Fleet `lkxAlQsp`; created via `apps/api/scripts/create-founding-coupons.mjs`).
  Env-gated (`PROMO_FOUNDING_ENDS_AT` + `STRIPE_COUPON_FOUNDING_*`). Banners on home/pricing/
  signup + strikethrough price on pricing cards (live per-request via `getPromo()` no-store).
  **⚠️ Real discounts need LIVE Stripe** (still TEST mode — see Stripe cutover blocker).
- **Multi-truck capacity** — `operators.truck_count` (migration `20260710000001`), 30-min
  travel buffer, capacity from our appointments DB (`modules/appointments/capacity.ts`);
  onboarding + settings fields. External Google events ignored for multi-truck (per decision).
- **SEO Tier 1 + 2** — sitemap.ts, robots.ts, JSON-LD (Org/Software/FAQ), 5 per-trade pages
  `/for/{trade}` (`lib/trades.ts`).
- **AEO** — AI-crawler allow rules in robots.ts, `/llms.txt`, HowTo/Service schema,
  `/answering-service-for-contractors` answer page. **Cloudflare verified allowing AI bots.**
- **Dashboard** — Upcoming vs Past appointments split. **CI fix** — `pnpm audit` endpoint was
  410-failing every deploy; made report-only in `.github/workflows/ci.yml`.
- **Google OAuth verification SUBMITTED** (2026-07-10) — awaiting Google (days–weeks; watch
  `malhotra.vikas@gmail.com`). Scope narrowed to `calendar.freebusy`. "Run test booking"
  button in Settings→Integrations exercises both scopes.

### Tomorrow — pick up here (in priority order)
1. **Commit the uncommitted docs** (CLAUDE.md, PROGRESS.md, SEO_AEO.md).
2. **Set promo env on Railway API** if you want the banners live on prod (currently only in
   local `.env.local`): `PROMO_FOUNDING_ENDS_AT` + the 3 `STRIPE_COUPON_FOUNDING_*`. Use TEST
   coupon ids to preview; LIVE ids at Stripe cutover for real discounts.
3. **SEO/AEO off-site work** (👤, highest ROI — see `docs/SEO_AEO.md` checklist): Google Search
   Console + Bing submit sitemap; **G2 + Capterra listings + real reviews**; Google Business
   Profile. Also glance Cloudflare **AI Crawl Control** + **Security→Bots** (Bot Fight off).
4. **⚠️ Pre-existing prod bug:** `STRIPE_PRICE_SOLO_MONTHLY` on prod still points at the OLD
   $49 (now inactive) price → real Solo checkouts fail. Repoint to `price_1Tot57BrlSqhHprpsC58Fldf`
   ($325) — part of the Stripe live cutover.
5. Optional code follow-ups: AggregateRating/Review schema hook (for when reviews arrive),
   trade links in top nav, per-page OG images. And **SEO_AEO.md** is the living tracker.

### Launch blockers (from PROGRESS.md Status)
- 🟠 **Google OAuth** — submitted, awaiting review.
- 🔴 **Stripe test→live cutover** — the remaining hard blocker for real money (live keys,
  live prices/coupons, both webhooks, operator Connect re-onboarding, existing test-mode
  Stripe IDs on operator rows). Needs the go-live checklist doc written.

---

## Resume brief — Monday 2026-06-29 (after 2026-06-26 session, Mac restarted)

**Where we are:** mid manual-test **§11** (the full booking/fee value loop). §1–§10 all
pass (a few non-blocking deferrals). **All code committed + pushed** (latest `42627dd
"Improved UX"`); working tree clean. OpenAI works again (the prod key was out of quota →
"AI never replies"; new funded key deployed). `gpt-4.1`. Also landed this session:
emergency visit fee (17e: setting + pricing), business hours editor, footer on all pages,
AI-failure fallback + Slack alert, and a **big UI/UX design pass** (see below).

### UI/UX design pass — status (shipped this session, deployed)
Design system (Space Grotesk + Inter fonts, brand-purple gradient/glow/shadow tokens,
`Reveal` scroll-motion component, `card-lift`, reduced-motion safety) + global display-font
headings + global accented gradient background w/ ambient blobs on every page. Polished:
homepage (gradient hero, elevated/numbered cards, scroll reveal), pricing (fanmaker-style
tier cards), contact cards, and shared app primitives (SettingsPanel Card, onboarding
StepCard, dashboard Stat tile, Nav glass header, AuthForm gradient button, auth card).
**Verified the 9 PUBLIC pages via Playwright screenshots — polished + uniform.** **NOT yet
eyeballed: the authed pages** (dashboard/settings/onboarding/admin) — a sandbox netns quirk
blocked screenshotting them HERE, but **Playwright is installed** and works on the real Mac,
so Monday: run the authed-page screenshots (mint a session via the magic-link/`/auth/confirm`
flow — script pattern in `scratchpad/authshot.js` from this session) OR just eyeball them in
a browser. **Still to do:** per-page polish on dashboard/onboarding/admin buttons + layouts.

### Monday — ordered priorities
1. **Finish §11 — the value loop (the main thing left).** Test operator
   `malhotra.vikas+cd@gmail.com` (Chicken Dinner, Twilio **+1 424-425-3663**) is set up:
   Twilio ✓, Google Calendar ✓, booking fee $250 + emergency $150 ✓, business hours
   Mon–Fri 9–5 ✓, subscription active ✓. **Missing: Stripe Connect onboarding**
   (charges/payouts = false). Do:
   a. Finish cd's **Stripe Connect Express** onboarding (test SSN `000-00-0000`) → charges_enabled + payouts_enabled = true.
   b. **Call +1 424-425-3663 directly** from another phone (bypasses the flaky T-Mobile carrier forwarding) → reply with a **ROUTINE, non-emergency** job (e.g. "replace a faucet next week") → AI vets → proposes slots (business hours now set) → books.
   c. Confirm: Google Calendar event created, `appointments.google_event_id` set, `payments.amount_cents` = deposit + platform fee, `fee_status=paid`, platform fee lands on the **platform** Stripe balance.
   - Verifiers: `apps/api/scripts/verify-consent-flow.mjs <caller#>` (convo/messages), `verify-admin-actions.mjs <email>` (operator state). `.env.local` points at PROD.
   - NOTE: an active EMERGENCY (flooding/gas) escalates to a human by design — use a routine job to exercise booking.
2. **🔴 Google OAuth verification** (the launch blocker) — branding ✅ + scopes declared ✅; **record the demo video + submit**. Everything (justifications, script, steps) is in `docs/google-oauth-verification.md`. Review takes days–weeks → start early.
3. **Confirm the emergency-fee migration ran on prod** (`20260626000001_operator_emergency_visit_fee.sql`) — the Settings emergency-fee save errors if the column is missing.

### Then the build backlog (priority order — all detailed in PROGRESS.md)
- **17d** Slack "Send payment request" button — this is what actually CHARGES the emergency fee (17e only shipped the setting + pricing). Then **17b** unify emergency (alert operator + #hitl), **17c** collect name/address before handoff.
- Plan upgrade/downgrade (self-serve, prorated refund).
- **2b** multi-truck capacity booking (concurrency + duration config).
- **UI revamp finish** — eyeball/polish authed pages (dashboard/onboarding/admin).
- **Cal.com demo form** — add a required Phone question (Cal dashboard, no code; fix "Host | Host" title).
- Slack app rebrand → KeeprSteady. Global audit-log report. SuiteCRM + Square (post-launch).

### Known bug (not blocking, debug later)
Opening SMS lands in a SEPARATE phone thread from bot replies — Twilio-layer (our code sends both from `operator.twilio_number_e164`); + duplicate-opening observed. See PROGRESS "Known issue."

### Gotchas (carry over)
- **Cloudflare must NOT challenge `api.keeprsteady.com` NOR `keeprsteady.com`** — the web-root challenge blocked Google's crawler (3 verification rejections). `curl -sI` both → 200, no `cf-mitigated: challenge`.
- `.env.local` → **PROD** Supabase (`ozsckjjlydtujbhajjla`) + service role; local writes hit prod. Use `+test` emails.
- db-types hand-edited for new columns (`emergency_visit_fee_cents`, …); `pnpm gen:db` regenerates identically. ~~Migrations apply via Railway pre-deploy `pnpm db:migrate`.~~ **Wrong (found 2026-10-26): nothing applies migrations on deploy — run `supabase db push` before pushing. See CLAUDE.md §14.**

---

## ⬇️ Older brief (2026-06-23) — superseded; kept for reference

## Resume brief — next session (after 2026-06-23, Mac restarted)

**FIRST THING TOMORROW: deploy this session's work to prod + run the manual test
script (`docs/manual-test-2026-06-23.md`).** A large batch of fixes + two features
landed today. Everything typechecks and unit tests pass, but it is **all
uncommitted and NOT deployed**. The plan we agreed: deploy → apply migrations →
manually test on **prod** using the script.

### What shipped today (uncommitted — see PROGRESS.md "2026-06-23" section for detail)
1. **A2P affirmative voice IVR** — caller must press 1 / say "yes" before any SMS
   (`/consent` callback). Web `/messaging/opt-in` consent form + `POST /v1/sms-opt-in`
   + `sms_consents` log. `/messaging` quotes the verbatim disclosure. This is the
   new basis for the A2P resubmission (consent now affirmative + provable).
2. **Sales role (#4)** — `role='sales'` (admin-set), `SalesGuard`, `sales_slack_links`
   table, `POST/DELETE /v1/admin/sales`, `GET /v1/sales/leads`,
   `POST /v1/sales/operators/:id/impersonate` (scoped to claimed leads). Web `/sales`
   rep surface + "Login as", `/admin/sales` promote form, middleware routing.
3. **Usage metering** — counts conversations per billing cycle; `operators.current_period_*`
   from the Stripe webhook; dashboard usage meter. Display-only (enforcement later).
4. **Account/auth fixes** — forgot/reset password (`/forgot-password`, `/reset-password`,
   `/auth/callback`); signup confirm now lands on `/onboarding` (was home);
   terms re-accept modal closes instantly (was awaiting a cold API call).
5. **Dark mode removed** (light-only). **Pricing copy fix** (annual "2 months free"
   no longer reads as a monthly perk).
6. **#5 admin login-as** was already built — only blocked by the Cloudflare issue.

### Tomorrow's ordered runbook
1. **(Decide) commit** the working tree — it's large and uncommitted. Suggest a
   branch `feat/2026-06-23-auth-sales-usage` (or commit to main if you prefer),
   then deploy. `git status` shows api + web + supabase/migrations + packages/db-types + docs.
2. **Apply migrations to prod, in order:** `20260622000001`, `20260623000001`,
   `20260623000002`, `20260623000003` (~~Railway pre-deploy `pnpm db:migrate` does run~~ — wrong, see CLAUDE.md §14).
3. **Deploy api + web** to prod.
4. **Prod config:** Supabase → Auth → Redirect URLs must include
   `https://keeprsteady.com/auth/callback`. Confirm `NEXT_PUBLIC_APP_URL` /
   `APP_URL` = `https://keeprsteady.com`, `NEXT_PUBLIC_API_URL=https://api.keeprsteady.com`.
5. **Supabase email templates** → replace "BookingBlues" → "KeeprSteady" (Confirm
   signup / Reset / Magic Link / Invite). Dashboard change, not code (manual-test §0.6).
6. **Verify Cloudflare API is clear** (you flipped `api` to grey/DNS-only):
   `curl -i https://api.keeprsteady.com/v1/health` → JSON 200, not "Just a moment".
7. **Run `docs/manual-test-2026-06-23.md`** on prod. Intro/test account =
   `malhotra.vikas+1@gmail.com` (admin + Zeus Electrical operator, +1 385-317-1322).

### A2P 10DLC — resubmission ready (new affirmative-consent basis)
Today's affirmative IVR + the `/messaging/opt-in` web form give two provable
consent methods. Resubmission package (campaign fields + Nayana reply + the
Google-Drive consent doc with the verbal transcript) was drafted in chat —
see the campaign-fields + transcript text. Still need: host the consent doc on
Google Drive (public link) with screenshots of `/messaging/opt-in` + `/messaging`,
paste into the campaign "How do end users consent" field, resubmit `CMcc65e4…`,
and reply on the Nayana ticket mapping each rejection point to the fix.

### NEW gotchas from today (so you don't re-discover)
- **Local dev port collision**: web is 3000, API is 3001. If you start two web dev
  servers, the 2nd grabs 3001 (Next auto-increments) and the API can't bind →
  dashboard 404s on every `/v1/*` call. Check: `curl http://localhost:3001/v1/health`
  must be JSON 200, not a Next.js page. (We are testing on PROD now, so less relevant.)
- **`.env.local` points at PROD Supabase** (`ozsckjjlydtujbhajjla`) + has the service
  role key — local dev writes to prod. Be careful; use `+test` emails.
- **Cloudflare must not challenge `api.keeprsteady.com`** — JS challenges 403 all
  XHR AND every Twilio/Stripe/Google webhook. Keep the `api` record DNS-only (grey).
- **Stripe `current_period_*`** only populates on a subscription webhook — existing
  operators show calendar-month usage until then (a one-time backfill would fix it).
- db-types were **hand-edited** for `sms_consents`, `sales_slack_links`, `lead_claims`
  (was missing), and `operators.current_period_*`. `pnpm gen:db` will regenerate identically.

---

## ⬇️ Prior-session context (2026-06-17) — reference + still-open backlog only

Today's brief (above) supersedes the deploy/commit steps. The items below
(A2P toll-free track, Sentry DSNs, daily-summaries cron, open build tasks, and
the wiring/gotchas reference) are still accurate. NOTE: the **toll-free
provisioning** code (`twilio-provisioning.*`) is still in the working tree
uncommitted — it'll go in with tomorrow's commit.

### State in one paragraph
KeeprSteady runs entirely on **keeprsteady.com / api.keeprsteady.com** now (full
domain cutover). Shipped + deployed today: billing-flow hardening (dup-checkout
dedup + past-due degraded mode), security (trust-proxy fix + Permissions-Policy;
rate-limit/CORS/helmet were already done), STOP/HELP 21610 handling, **CI**
(GitHub Actions on push to main — green), **Sentry** (api+web, inert until DSNs
set), **SMS templates module** + **1-hour reminder cron** (DB migration applied
on prod, Railway cron firing every 5 min, verified 200), the public
**/messaging** opt-in page, and **toll-free provisioning** (code, uncommitted).
A2P 10DLC campaign was rejected twice (now only on 30909 = consent-verification);
**resubmitted** with tightened Message Flow + live /messaging URL, and a Twilio
**support ticket** is open. The product is **multi-trade Home Services** (not
plumber-only) — roadmap Slices 17-22 still use legacy plumber wording, generalize
as you build them (memory: `project_home_services_not_plumber_only`).

### 1. First thing: commit the uncommitted batch
Working tree has the **toll-free provisioning** code + this doc + PROGRESS.md:
```bash
git status            # M: twilio-provisioning .controller/.dto/.service, docs/*
git add apps/api/src/modules/telephony/ docs/
git commit -m "Add toll-free number provisioning option + progress/resume docs"
git push origin main  # → CI runs + Railway auto-deploys
```
Everything else is already committed + deployed (HEAD `14b8739`).

### 2. A2P 10DLC — RESUBMIT-READY (the launch gate for SMS)
Rejections so far cleared progressively: 30886 (description) ✅ → 30909 (consent)
✅ → rejection #3 "website doesn't match brand" → **now addressed**:
- ✅ **Live on keeprsteady.com:** "Malhotra Consultants LLC" now shows in the
  **header** ("by Malhotra Consultants LLC" by the logo, commit `7641061`) AND
  the **footer** ("…service operated by…" + "© <yr>…", commit `97ec41c`), on
  every page incl. /messaging, /terms, /privacy. Verified live.
- ✅ Brand's registered website field confirmed = `https://keeprsteady.com`.
- **DO: resubmit campaign `CMcc65e4…`.** Optionally first update the description
  to lead with "Malhotra Consultants LLC … at https://keeprsteady.com" (legal
  name + exact URL together). Opt-in keyword stays blank (missed-call-triggered).
- **If it bounces a 3rd time on the SAME website-match reason** → reviewer-quirk,
  not a copy fix. Escalate via the open **Twilio support ticket** and run
  **Toll-Free** (#12) in parallel so SMS isn't blocked on 10DLC.
- **The real unblock is Toll-Free** (task #12): TFN verification is a *separate,
  independent* compliance track from 10DLC. Provision a toll-free number (Twilio
  console, or our new `toll_free:true` provision endpoint once deployed), add it
  to the Messaging Service, and **submit Toll-Free Verification** in the console
  citing /messaging. This gives a working SMS sender while 10DLC iterates.
- If 30909 fails a 3rd time: revisit adding a keyword opt-in (and decide whether
  to actually operate it).

### 3. Pending console/infra actions (your side, not blocking)
- **Daily-summaries cron NOT wired** (coded but dormant — was never running).
  Same recipe as the reminder cron, URL `/v1/internal/daily-summaries/run`,
  daily schedule `0 13 * * *`. Only matters once you have live operators.
- **Sentry DSNs** — create Sentry projects + set `SENTRY_DSN_API`,
  `SENTRY_DSN_WEB`, `NEXT_PUBLIC_SENTRY_DSN_WEB` on Railway. Inert until then.
- **CI branch protection** — manual GitHub UI step (see `docs/CI_AND_BRANCH_PROTECTION.md`).
- **Domain cleanup** — remove OLD Railway URLs from the Google authorized-redirect
  list + Supabase redirect allowlist (open-redirect surface).
- **Dependabot PRs** are open in the repo — ignore/merge at leisure (task #8).

### 4. Open build tasks (mine — say go)
- **#7 Operator UI polish** (web, generalize for home services) — conversation
  transcript view, appointment cancel UI, business-hours editor. The last of the
  original "four."
- **#12 Toll-Free** — provision + verify (mostly your console action; code is done).
- **#1 STOP/HELP (rest)** — forward-vs-intercept audit (needs live messaging),
  DB opt-out tracking + `opted_out` outcome, branded HELP/STOP copy.
- **#8 CI tightening** — remediate 11 transitive `form-data` highs → flip audit to
  `--audit-level=high`; fix eslint setup → flip lint/format to blocking; add the
  Supabase-backed test job (ephemeral project, never prod).
- Larger roadmap: Hardening Phases 2-6 (CodeQL/Trivy/pen-test), Slices 13/13.5/14,
  product Slices 17-22.

### Wiring / gotchas reference (so you don't re-discover)
- **Internal cron routes carry the `/v1` global prefix** — only `webhooks/*` is
  excluded in `main.ts`. So it's `/v1/internal/appointment-reminders/run` (404 if
  you drop `/v1`).
- **Reminder cron** lives in the **BookingBlues** Railway project as service
  "Reminder-CRON": image `alpine:latest`, schedule `*/5 * * * *`, start command
  `apk add --no-cache curl && curl -fsS -X POST "$API_URL/v1/internal/appointment-reminders/run" -H "X-Cron-Secret: $CRON_SHARED_SECRET"`,
  vars `API_URL` + `CRON_SHARED_SECRET`. **A cron service needs a Source image +
  an actual Deploy** — a saved schedule alone = "No deployments found" + never runs.
- Check cron runs: `railway logs --service "Reminder-CRON" -d --lines 25` (look
  for `{"window_minutes":60,...}`).
- `CRON_SHARED_SECRET` is set on the api service (64-char hex, `aa5ae0…e937`);
  local `.env.local` has the same value but **quoted** (dotenv strips quotes).
- ~~Railway pre-deploy `pnpm db:migrate` **does run**~~ (WRONG — corrected 2026-10-26, see CLAUDE.md §14; the reminder
  migration applied automatically on deploy).
- Stripe CLI defaults to the wrong account ("Reaper Labs") — `stripe login` →
  **BookingBlues** (`acct_1TUVtI…`, test mode).

### Latest commits (local `main`)
```
7641061 Brand Clarity for Twilio A2P10dlc     ← header "by Malhotra Consultants LLC"
97ec41c Added legal entity for Twilio A2P verification  ← footer entity
14b8739 Appointment and sms messaging         ← #6 templates+reminder+migration, /messaging
2b4d979 CI runs on push to main; finalize launch-readiness batch
99e91a1 Add Sentry error tracking (api + web) with PII scrubbing
8a14fde Add CI pipeline (typecheck/build/audit/gitleaks) + dependabot
```
**Uncommitted (commit first thing — see step 1):** toll-free provisioning
(`twilio-provisioning.{controller,dto,service}.ts`) + `docs/`. Header + footer
A2P-clarity changes ARE committed (`7641061`/`97ec41c`) and deployed/live.
