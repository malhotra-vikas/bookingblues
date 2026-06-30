# BookingBlues — Progress Tracker

Running source of truth for what's built, what's in flight, and what's next.
**Updated after every slice that ships.** Survives any restart (lives in git).

When a section is wrong or stale, fix it in the same commit as the change.

---

## Status

- **Phase**: Pre-launch (KeeprSteady rebrand + Solo/Crew/Fleet billing landed; infra verified live, functional E2E still pending)
- **Last updated**: 2026-06-25 (Twilio A2P 10DLC campaign **APPROVED** — SMS delivery now live; TERMS.version bumped to 2026-06-25 for §5 re-accept test)
- **🟢 A2P 10DLC APPROVED (2026-06-25)** — the campaign cleared. **US SMS now delivers** for real. This was the launch gate. Implications: manual-test §9 can be judged by actually receiving texts (not just Twilio/DB attempt logs); the full missed-call → SMS → booking loop is live-testable E2E for the first time; the Toll-Free track is no longer needed as the unblock (keep only if a redundant sender is wanted).
- **🔴 LAUNCH BLOCKER — Google OAuth sensitive-scope verification (in progress, see `docs/google-oauth-verification.md`).** Real operators can't connect Google Calendar (onboarding step 4 / §9.4) until the consent screen is verified for the sensitive `calendar.events` + `calendar.readonly` scopes; non-test-users see "Google hasn't verified this app." Progress as of 2026-06-26: ✅ **branding verified**; ✅ homepage reachable (root cause of 3 rejections was a **Cloudflare blanket challenge on `keeprsteady.com`** blocking Google's crawler — web root must stay un-challenged, `curl -sI` → 200 no `cf-mitigated`); ✅ scopes declared in Data Access; ⬜ **demo video** + ⬜ **submit for verification** (justifications + script all in the doc — user recording the video after finishing manual tests). Project `bookingblues-staging` / client `670004772057`, redirect `api.keeprsteady.com`. Interim: keep the test Google account in Test users (≤100). Review ≈ days–weeks once submitted.
- **Active slice**: none — launch-prep infra now verified against prod; remaining work is functional E2E testing + finishing the domain cutover.
- **Production target**: EC2 (Slice 14). Railway is staging only (Slice 13).
- **HITL**: Slack-based (Slice 7.5) — **shipped** (code, manifest, docs; needs the Slack app created in api.slack.com to function end-to-end).

### Prod infra verification — 2026-06-16

Re-verified the 2026-06-01 resume brief's blocker list against the live
systems (Railway linked to BookingBlues/production; Stripe CLI on the
`bookingblues` account `acct_1TUVtI…`; prod Supabase `ozsckjjlydtujbhajjla`).
**All of the brief's infra blockers are already resolved:**

- ✅ Terms migration applied to prod — `operators.terms_accepted_at` +
  `terms_version` present.
- ✅ Plan migration applied to prod — `operators.plan` + `plan_cadence` +
  `stripe_price_id` present.
- ✅ All 6 Stripe prices live and env-wired at correct amounts
  (Solo 4900/49000, Crew 65000/650000, Fleet 149900/1499000).
- ✅ Category gate **open to all 5 trades** in prod — `ENABLED_CATEGORIES`
  unset on the api service and `NEXT_PUBLIC_ENABLED_CATEGORIES` unset on the
  web service.
- ✅ Prod API + web deployed and healthy (200).

**Still genuinely open:** functional E2E walkthroughs — billing
checkout→DB, terms re-accept gate, non-plumbing emergency SMS, visual QA.

### Domain cutover to keeprsteady.com (Slice 13.5) — ✅ done 2026-06-16

Full swap to the owned domain. Targets: web `https://keeprsteady.com`,
api `https://api.keeprsteady.com` (both custom domains already provisioned on
Railway and serving). No code changes — every URL is env-driven
(`API_URL`/`APP_URL`/`NEXT_PUBLIC_*`; CORS reads `env.APP_URL`; Twilio webhook
URLs built from `env.API_URL`). Verified no hardcoded Railway URLs in source.

- ✅ Railway **api**: `API_URL=https://api.keeprsteady.com`,
  `APP_URL=https://keeprsteady.com`,
  `GOOGLE_OAUTH_REDIRECT_URI=https://api.keeprsteady.com/webhooks/google/oauth/callback`
- ✅ Railway **web**: `NEXT_PUBLIC_API_URL=https://api.keeprsteady.com`,
  `NEXT_PUBLIC_APP_URL=https://keeprsteady.com`
- ✅ **Stripe** platform webhook endpoint `we_1TUW2c…` repointed to
  `https://api.keeprsteady.com/webhooks/stripe` (signing secret unchanged →
  `STRIPE_WEBHOOK_SECRET` untouched). No Connect endpoint exists in prod.
- ✅ **Twilio** all 3 provisioned numbers' voice+sms URLs repointed to
  `api.keeprsteady.com` (operator-id paths preserved).
- ✅ **Google Cloud** OAuth client redirect URI + consent-screen domain
  updated (user, console). Env flip was gated on this to avoid
  `redirect_uri_mismatch`.
- ✅ **Supabase** Auth Site URL + redirect allowlist updated to keeprsteady.com
  (user, dashboard — CLI is on a different account, can't reach this project).

**Validation passed (2026-06-16):** api health 200; web home 200; CORS
preflight returns `access-control-allow-origin: https://keeprsteady.com`;
Google OAuth callback 302 → `https://keeprsteady.com/onboarding?error=…`;
Stripe endpoint unsigned POST → 400 (sig-reject, handler alive); web bundle
has zero stale old-domain references.

**Cleanup still to do:** after the functional E2E confirms the new domain end
to end, remove the OLD Railway URLs from the Google authorized-redirect list
and the Supabase redirect allowlist (leaving them is an open-redirect/abuse
surface). Optionally refresh example URLs in `docs/DEPLOY_RAILWAY.md`.

### A2P 10DLC + Track B (Messaging Service wiring) — 2026-06-16

US SMS was blocked because no A2P 10DLC brand/campaign existed (CLAUDE.md §17).

- ✅ **Brand** `BNc842…` registered + **APPROVED** (Standard).
- ❌ **Campaign** `CMcc65e4…` (msg-svc resource `QE2c68…`; Low Volume Mixed,
  use case LOW_VOLUME) — **REJECTED** by carriers 2026-06-16 (see resubmission
  block below). Messaging stays "disabled" on the numbers until an approved
  campaign clears.
- ✅ Auto-created **Messaging Service** `MG4b74e3498aa730f7fc57895e4b40a250`
  ("Low Volume Mixed A2P Messaging Service") is bound to the campaign;
  `use_inbound_webhook_on_number=true` so inbound SMS keeps using each number's
  per-operator webhook.
- ✅ Backfilled all 3 existing numbers into that Messaging Service's sender pool.
- ✅ Legal pages updated for carrier review: `/terms` §7 "SMS Messaging Program
  (End-User Terms)" and `/privacy` §6 "SMS and Text Messaging Consent" (HELP,
  STOP, frequency, "msg & data rates", opt-in-not-shared clause). Added
  `BRAND.supportEmail = support@keeprsteady.com` as the HELP contact.

**Track B — provisioning auto-attach (shipped):**
- `TWILIO_MESSAGING_SERVICE_SID` set on Railway api + local `.env.local`
  (already in env schema + `.env.example`).
- `twilio-provisioning.service.ts`: after `incomingPhoneNumbers.create`, the
  number is added to the Messaging Service pool so every future number inherits
  the brand+campaign with no per-number step. Best-effort (loud error log on
  failure, never orphans the purchase; warns if the SID is unset).
- **`sendSms` deliberately unchanged** — we keep `from=<operator's own number>`
  so each caller is texted from the number they dialed. A2P attribution follows
  the number's Messaging-Service membership, not the send method (confirmed via
  Twilio docs), so per-operator sender identity is preserved. Do NOT switch to
  `messagingServiceSid` (shared pool → Twilio could pick another operator's
  number). API typecheck clean.

**Pre-launch deps still external:** wait for campaign approval; consider a
Toll-Free verified number for early customers while Low Volume clears (§17).

#### Campaign rejection #1 + resubmission (2026-06-16)

Campaign `CMcc65e4…` rejected. Codes:
- **30886** — Campaign description didn't clearly explain who sends / who
  receives / why (and must match use case + samples + registered brand).
- **30909** — opt-in / Message Flow didn't give reviewers enough to verify how
  end users consent.

Root cause is the classic missed-call-text-back "can't verify consent" review.
The live `/terms` §7 + `/privacy` §6 SMS disclosures ARE deployed and compliant
(verified live), so the fix is the campaign form copy itself, not the URLs/code.
Resubmit via Messaging → Regulatory Compliance → A2P 10DLC → Campaigns →
`CMcc65e4…` → Edit & resubmit. Keep the existing 5 sample messages.

Replacement **Campaign Description** (ties brand "Malhotra Consultants LLC" to
product "KeeprSteady" to avoid a brand-mismatch flag):

> KeeprSteady is a software platform operated by the registered brand Malhotra
> Consultants LLC. It runs this messaging program on behalf of individual
> home-service contractors who subscribe to it (plumbing, HVAC, electrical,
> roofing, garage door). Sender: the subscribing contractor's business, using
> its own dedicated KeeprSteady 10DLC number. Recipients: homeowners and
> customers who have just called that contractor's published business phone
> number and did not reach a person. Why: to text the caller back and help
> schedule the service they were calling about — collecting job details,
> proposing available appointment times, confirming the booking, and optionally
> sending a secure link to pay a booking deposit. These are one-to-one,
> conversational customer-care messages, sent only in direct response to an
> inbound phone call from the recipient. No marketing or promotional messages
> are sent. Message volume is low.

Replacement **How do end users consent / Message Flow** (names the verbal
voice-greeting disclosure as a pre-SMS consent touchpoint — the key lever):

> Consent is obtained through a consumer-initiated phone call. No phone numbers
> are ever purchased, rented, shared, or sold, and no contact lists are used.
> Opt-in workflow: 1. A homeowner dials a contractor's published business phone
> number. 2. If the call is unanswered or busy, the contractor's carrier
> conditionally forwards it to the contractor's dedicated KeeprSteady number.
> 3. KeeprSteady answers with a brief voice greeting that explicitly tells the
> caller they will receive a text to schedule (for example: "Thanks for calling
> [Business Name]. Sorry we missed you — we'll text you right now to get you
> scheduled."). This verbal disclosure occurs before any SMS is sent.
> 4. KeeprSteady then sends a single SMS to the exact number the customer called
> from. The first message identifies the business and includes: "Reply STOP to
> opt out, HELP for help. Msg & data rates may apply." Because the consumer
> initiated the call and is verbally told they will be texted, they have a clear
> and reasonable expectation of receiving the message. Messages are only ever
> sent to a number that called the business first. Full SMS program terms
> (message frequency, message and data rates, HELP, and STOP) are published at
> https://keeprsteady.com/terms in the "SMS Messaging Program" section, and our
> privacy policy — which states that SMS opt-in information is never shared with
> third parties — is at https://keeprsteady.com/privacy.

**If rejected again:** narrow the use case from Low Volume Mixed to a single
Customer Care framing, and/or stand up a Toll-Free verified number to start
testing while 10DLC iterates (§17).

#### Campaign rejection #2 + mitigations (2026-06-17)

Resubmission rejected again — but **only 30909** this time (the 30886 description
error cleared, so the description fix worked). 30909 is the call-deflection wall:
carriers can't *verify* a call-only opt-in (no webform/checkbox to inspect; the
sub-codes 30924/30925 describe a webform-style active opt-in we don't have).
Iterating the same copy a third time will likely fail again. Three parallel
mitigations shipped/queued 2026-06-17:

- ✅ **Public opt-in artifact** — `apps/web/app/(marketing)/messaging/page.tsx`
  (`/messaging`, linked in the footer): a carrier-inspectable page documenting
  the consumer-initiated call→text opt-in workflow, exact disclosure, frequency,
  rates, HELP/STOP, no-purchased-lists framing. **Cite this URL in the Message
  Flow** on the next resubmit.
- ✅ **Toll-Free provisioning** — `twilio-provisioning.service` now supports
  `toll_free: true` (search/buy a toll-free number, attach to the Messaging
  Service, same webhooks). TFN verification is a separate, often-faster Twilio
  path — the real way to start sending while 10DLC iterates. **Action (user):**
  provision a TFN and submit toll-free verification in the console.
- 📝 **Twilio Support ticket** — drafted (in chat); open it for human review of
  the call-deflection use case after two auto-rejections.

Tighter Message Flow copy (cites `/messaging`) was also drafted in chat for the
next 10DLC resubmit.

**Decision (2026-06-17):** leave the **Opt-in Keyword / Opt-in Message blank**
this round. The product is **missed-call-triggered** — it does not expect a
texted keyword from the consumer — so registering a "text START to opt in" path
would misrepresent the actual flow. Plan: resubmit with the tightened Message
Flow + live `/messaging` URL only. **If 30909 fails a third time, THEN** evaluate
adding a keyword opt-in (`START` + a compliant opt-in message) as a secondary
verifiable path, and decide whether to operate it for real (Advanced Opt-Out).

#### Campaign rejection #3 — website/brand mismatch (2026-06-18)

**Consent (30909) cleared** — new rejection: *"the provided website URL does not
match the Brand and Campaign registered."* The brand is registered as **Malhotra
Consultants LLC** (`BUec4b108…`, Low Volume Standard, Registered) but the website
is `keeprsteady.com`, and the site didn't visibly tie the two together. Fixes:
- ✅ **Code (web), deployed + LIVE:** added `BRAND.legalEntity = 'Malhotra
  Consultants LLC'`. The site-wide **footer** (commit `97ec41c`) reads
  "KeeprSteady is a service operated by Malhotra Consultants LLC" + "© <yr>
  Malhotra Consultants LLC", and the marketing **header** (commit `7641061`) now
  shows "by Malhotra Consultants LLC" next to the logo — so the entity appears
  top AND bottom of every page (home, pricing, faq, contact, /messaging, /terms,
  /privacy). Verified live on keeprsteady.com (6 occurrences incl. RSC payload).
- ✅ **Console (user):** brand's registered website field confirmed =
  `https://keeprsteady.com`.
- **STATUS: resubmit-ready.** All known gates addressed (description ✅, consent
  ✅, website-identity ✅). On the next resubmit, optionally lead the campaign
  description with "Malhotra Consultants LLC … at https://keeprsteady.com" so the
  legal name + exact brand URL appear together (drafted in chat).
- **If it bounces a 3rd time on the SAME reason** with entity now in header +
  footer + brand field: it's a reviewer-standard quirk, not a copy problem —
  escalate via the Twilio support ticket (ask point-blank what "website matches
  brand" requires for product-under-LLC) and run **Toll-Free** (#12) in parallel.

**Follow-up — STOP/HELP keyword support (tracked):** we promised HELP/STOP in
the legal pages; need to (1) confirm whether Twilio intercepts STOP/HELP/START
vs forwards to our webhook, (2) handle Twilio error 21610 (opted-out) in the
send path instead of throwing loudly, (3) choose branded HELP/STOP copy that
preserves per-operator `from` identity, (4) add DB-level opt-out tracking
(deferred from Slice 16) so the bot stops messaging opted-out callers. See the
"DB-level opt-out tracking deferred" note under Slice 16.

#### Campaign rejection #4 + affirmative opt-in build (2026-06-22 → deployed 2026-06-23)

Rejection email (Nayana, Onboarding & Compliance). Three reasons:
1. The **consent form URL is missing** from the submission.
2. **All consent methods must be present + proven** via screenshots or links.
3. **Verbal consent must include the specific opt-in verbiage** (their example
   shows a full IVR disclosure + an affirmative "yes").

Decision (user-chosen): stop relying on a one-way call disclosure and build a
**real affirmative opt-in** on both channels, so each method is verifiable.

- ✅ **Web opt-in form (functional, records consent)** — `/messaging/opt-in`
  (`apps/web/.../messaging/opt-in/{page,OptInForm}.tsx`). Name + mobile + an
  **unchecked-by-default** consent checkbox with full CTIA disclosure. Posts to
  new public API `POST /v1/sms-opt-in` (`apps/api/src/modules/consent/`), which
  validates+normalizes the phone (E.164) and writes a durable consent row.
  **Fails loudly** if the row can't be written (no silent fallback, §2).
- ✅ **Affirmative IVR** — `twilio-voice.controller.ts` no longer texts on the
  inbound call. It plays a full disclosure (rates, STOP, HELP) and asks the
  caller to **press 1 / say "yes"** (`<Gather>` dtmf+speech). New
  `POST :operatorId/consent` callback sends the opening SMS **only on a clear
  affirmative**; decline/hang-up → polite goodbye, no text. Default-deny logic
  extracted to pure `callerConsentedFromGather()` + unit-tested
  (`twilio-helpers.spec.ts`, 6 tests green).
- ✅ **Consent log** — `sms_consents` table (migration `20260622000001`) stores
  web opt-ins; voice opt-ins recorded too (`source='voice_ivr'`, stores the exact
  spoken disclosure + how they affirmed). Migration `20260623000001` makes
  `name` nullable (voice has no name). `VOICE_CONSENT_TEXT`/`CONSENT_TEXT` in
  `sms-consent.dto.ts` are the single source for spoken text = stored proof =
  carrier transcript.
- ✅ **`/messaging` page** updated to quote the new disclosure verbatim and
  describe the affirmative opt-in (both channels).

**Deploy status:** user deployed the IVR + form + endpoint + first migration
(2026-06-23). **Still to confirm:** apply migration `20260623000001` (name
nullable) to prod — if it lags, SMS still sends (consent-row insert is
best-effort/loud-log only). The `callerConsentedFromGather` extraction + test
are behavior-identical and **not yet redeployed** (land with next push).

**Pre-resubmit gate:** place one live test call — press 1 → SMS arrives;
hang up → no SMS. Verifies the `/consent` callback signature validates against
prod `API_URL`.

**Resubmission materials (drafted in chat 2026-06-22):** consent form URL =
`https://keeprsteady.com/messaging/opt-in`; a Google-Drive-hosted consent doc
(both methods + a verbal IVR transcript in Twilio's format) for the "How do end
users consent" field; screenshots of `/messaging/opt-in` + `/messaging`; use
case = Customer Care / Conversational.

### Account/auth + sales-role + infra session — 2026-06-23

Batch of fixes + one feature. All typecheck clean; **uncommitted** (land with next push). Several depend on prod config (noted).

- ✅ **Affirmative voice IVR opt-in (A2P)** — caller must press 1 / say "yes" before any SMS; `/consent` callback + `callerConsentedFromGather` (unit-tested). Web `/messaging/opt-in` consent form + `POST /v1/sms-opt-in` + `sms_consents` log (migrations `20260622000001`, `20260623000001` name-nullable). `/messaging` quotes the verbatim disclosure.
- ✅ **Dark mode removed** — deleted the no-flash script + `ThemeToggle`; site is light-only. (`dark:` utility classes left inert.)
- ✅ **Terms re-accept latency fix** — `accept-terms` no longer awaits the best-effort operators-mirror POST (cold API was stalling the modal close).
- ✅ **Forgot/reset password** — `/forgot-password` + `/reset-password` + `/auth/callback` PKCE route; "Forgot password?" on login.
- ✅ **Signup email-confirm landing** — signup sets `emailRedirectTo=/auth/callback?next=/onboarding` (was falling back to Site URL = home). **Prod Supabase: add `https://keeprsteady.com/auth/callback` to Redirect URLs; set `NEXT_PUBLIC_APP_URL`.**
- 📝 **(1) Confirmation email still says "BookingBlues"** — hosted Supabase dashboard → Auth → Emails templates (Confirm signup / Reset / Magic Link / Invite). Not in repo.
- ✅ **#4 Sales role (backend + web)** — `role='sales'` (admin-set), `SalesGuard`, `sales_slack_links` (`20260623000002`), `lead_claims` added to db-types. Endpoints: `POST/DELETE /v1/admin/sales` (promote+link / demote), `GET /v1/sales/leads`, `POST /v1/sales/operators/:id/impersonate` (scoped to claimed leads, audited `sales.impersonate`). Web: `/sales` rep surface + "Login as", `/admin/sales` promote form, middleware routes reps to `/sales`. Tests: SalesGuard + jwt verifier `isSales`.
- ✅ **#5 admin "login as"** — already existed (`OperatorActions` Impersonate); was only blocked by the Cloudflare issue below.
- ✅ **Usage metering (conversations / billing cycle)** — count **every conversation row** in the operator's **current billing period** (trial window for trials), display-only. Migration `20260623000003` adds `operators.current_period_start/end`, mirrored from the Stripe subscription webhook (`onSubscriptionUpserted`). `billing/plan-limits.ts` maps plan→limit (solo 80 / crew 500 / fleet 1500, mirrors web brand.ts). `dashboard.service.metrics` returns a `usage` block (falls back to calendar month if period unsynced); dashboard shows a usage meter. **Note:** existing operators show calendar-month fallback until their next subscription webhook populates the period — a one-time Stripe backfill would make it exact immediately.

**🔴 Prod infra — Cloudflare was 403-challenging the API** (`api.keeprsteady.com`, `cf-mitigated: challenge`), breaking ALL dashboard/admin XHR **and every Twilio/Stripe/Google webhook**. Resolved by flipping the `api` DNS record to **grey/DNS-only** (2026-06-23). Verify: `curl -i https://api.keeprsteady.com/v1/health` returns JSON 200, not the CF "Just a moment" page.

**Migrations to apply (prod, in order):** `20260622000001`, `20260623000001`, `20260623000002`, `20260623000003`.

### Manual-test findings — 2026-06-24 (running docs/manual-test-2026-06-23.md on prod)
Passing so far: §1 dark-mode removed, §2 pricing copy, §3 signup→confirm→onboarding
(lead lands in Slack new-leads, claim works, pre-verify login blocked, verify link →
/onboarding, admin mark-verified path works, email is KeeprSteady-branded), §4 forgot/reset
password (after Resend SMTP fix), §5 terms re-accept latency (2026-06-25: bumped
TERMS.version → 2026-06-25, every account saw the re-accept popup, Accept landed on
/dashboard immediately — no hang).

- [x] **✅ RESOLVED 2026-06-24 — Supabase auth emails were hitting "email rate limit
  exceeded"** (found at §4 forgot-password). Root cause: prod was using Supabase's
  built-in email sender (~3–4 emails/hr, testing-only); §3 signup confirmations
  exhausted it. **Fix applied:** configured **custom SMTP → Resend** in Supabase →
  Auth → SMTP Settings (host `smtp.resend.com`, port 465, user `resend`, password =
  Resend API key, sender `no-reply@keeprsteady.com` / "KeeprSteady"; `keeprsteady.com`
  verified in Resend) and raised the Auth email rate limit. Verified: §4 forgot →
  reset email delivered via Resend, password reset + login with new password worked,
  old password rejected. All auth emails (confirm/reset/magic-link) now go through
  Resend, same as app transactional email.
- [ ] **Rotate the Resend API key** — the sending key was exposed in-session on
  2026-06-24; rotate in Resend + update `RESEND_API_KEY` on Railway (api) and the
  Supabase SMTP password. Low urgency (restricted sending-only key).

### §6 findings + fixes — 2026-06-25 (dashboard usage + plan surfacing)
Running §6 on prod (operator `malhotra.vikas+1`, Zeus Electrical, status=active) surfaced
that the operator's `plan` / `plan_cadence` / `current_period_*` columns were never
populated — root cause: the subscription webhook derived `plan` ONLY from
`sub.metadata.plan` (set once at checkout), so any sub whose metadata is absent/stale
(legacy, or a Customer-Portal plan switch) keeps `plan = null` forever. Three symptoms,
all fixed this session (uncommitted):
- **(A)** `stripe-event-handlers.ts` now derives plan+cadence from Stripe's **active
  price ID** (source of truth), metadata only as fallback. New
  `modules/billing/plan-pricing.ts` (`buildPricePlanMap` from the 6 `STRIPE_PRICE_*`
  env vars + `planCadenceForPrice`), threaded via `HandlerDeps.priceMap` from
  `stripe-platform.controller.ts`. Unit-tested (`plan-pricing.spec.ts`).
- **(B)** Backfill script `apps/api/scripts/backfill-operator-plans.mjs` — re-syncs
  plan/cadence/price/current_period_* from the live Stripe sub for every operator.
  **Dry-run by default; `--apply` to write.** RUN THIS ON PROD after deploying A so
  the existing operator's usage meter gets its limit + reset date.
- **(C)** Onboarding "Subscribe" step description no longer shows trial copy once
  subscribed — reads "You're on the {Plan} plan — N conversations/mo included…".
- **(D)** Settings → Subscription now shows the plan inline (name · cadence · convos/mo)
  via a new `PlanLine`, so you don't have to open the Stripe portal to see the plan.
The usage-meter UI (dashboard) was already correct — it only hid the limit/bar/reset
because the API returned `conversations_limit`/`period_end` null. No dashboard change.
**Status:** typecheck clean, 112 API tests pass. Deploy api+web, then run the backfill.

**§6 re-test — 2026-06-25 (RESOLVED, meter verified live).** After deploying A and running
the backfill, new signups metered correctly but the three *existing* operators still showed
no limit. Root cause #2: their Stripe subs were on the **retired "BookingBlues Starter" price**
(`price_1TUVwJBrlSqhHprpJGztuOPN`, $49/mo) — predates the Solo/Crew/Fleet rename, so it's not in
any `STRIPE_PRICE_*` env var. The backfill correctly leaves `plan` null for unmapped prices (by
design — see `plan-pricing.spec.ts:37`), so the meter had no limit. Fix: new script
**`apps/api/scripts/migrate-legacy-subscriptions.mjs`** (dry-run default, `--apply`) swaps legacy
subs to the equivalent current price (`LEGACY_MAP`: Starter→Solo monthly, same $49 →
`proration_behavior:'none'`), then re-run the backfill. Applied on prod: Zeus Electrical (`+1`),
Vikas Zeus, Medusa HVAC now `plan=solo/monthly`, meter shows **X / 80** with the real reset date.
(Note: backfill retrieve has Stripe read-after-write lag — run it twice after a migration; the
2nd pass picks up the new price.) **§6 PASSES.** Both scripts still uncommitted.
**Open follow-up:** operator `malhotra.vikas+2` points at a deleted Stripe sub
(`sub_1TWKIh…` → "No such subscription"); can't backfill/migrate — needs resubscribe or sub re-point
before it meters.

### §8 admin actions — PASS (2026-06-26)
Impersonate / force-end / release-Twilio verified earlier; the two bugs are fixed + **verified on
prod**: **Deactivate** now writes `subscription_status='canceled'` directly (was webhook-only, so
it never flipped for operators with a stale/deleted Stripe sub), and **Cancel Subscription**
reconciles the DB to canceled and tolerates a deleted Stripe sub (`resource_missing`) instead of
erroring. Per-operator login-block on deactivate was deliberately NOT added (status-only; operator
can still log in to a degraded dashboard). Verifier script: `apps/api/scripts/verify-admin-actions.mjs`.
**No "Reactivate operator" admin action exists** (deactivate is reversible in data but has no undo
button) — candidate follow-up. **§8 PASSES.**

### §9 voice IVR + consent — PASS (2026-06-26)
Voice IVR verified on prod: press-1 AND speech ("yes/yeah/sure") capture `sms_consents`
`source='voice_ivr'`, the opening SMS fires with real Twilio delivery (sids present), the AI
conversation advances, and default-deny works (random speech like "Oh God" → no consent, call
ends). Verifier: `apps/api/scripts/verify-consent-flow.mjs`. **Known design facts (not bugs):**
(a) `sms_consents` is **write-only** — recorded for both web_opt_in + voice_ivr but **read
nowhere**; it's an A2P evidence record, NOT a send-gate. Real enforcement = the in-call press-1
gate (`callerConsentedFromGather`) + Twilio's automatic STOP suppression. The `/messaging/opt-in`
web form just writes the evidence row; nothing reads it / no send is triggered by it. (b) The
speech matcher accepts the words `okay/ok/sure`, so a polite decline containing one ("no, that's
okay") would be logged as consent — narrow edge, optional 2-line decline-override offered, deferred.
**§9 PASSES.**

### §10 webhooks — Twilio PASS; Stripe deferred (2026-06-26)
(1) **Twilio webhooks through Cloudflare** — ✅ proven implicitly by the §9 live call reaching the
API (consent + opening SMS only happen if Twilio voice/SMS webhooks pass through the DNS-only
`api` record). (2) **Stripe subscription-update webhook** (`/webhooks/stripe` → operator update +
`current_period_*`) — **deferred** to the plan upgrade/downgrade build/test; **not launch-blocking**.

**🐞 Known issue — opening SMS lands in a SEPARATE phone thread (found 2026-06-26, debug later).**
After a call, the caller sees the first/opening SMS in a different message thread from the
subsequent bot replies. In code this shouldn't happen: both the opening
(`twilio-voice.controller` `startConversationFromCall`) and bot replies (`advance.service`
`sendBotSms`) send via `twilio.sendSms` with `from: operator.twilio_number_e164` — the SAME
number, and `sendSms` uses an explicit `from`, never the Messaging Service SID. So the split is
at the Twilio/delivery layer. Debug: compare the actual `From` of the two messages in Twilio
Console (or via `messages.twilio_message_sid` → Twilio API). Suspects: (a) the number's BB
**Messaging Service** membership presenting a different sender; (b) the **duplicate-opening**
behavior (the "Hi! Thanks for calling…" opener was observed sent twice) routing one copy
differently. Not launch-blocking but hurts the conversation UX.

**Deferred (not launch-blocking), to test later:** subscription Update / upgrade / downgrade
(ties to the self-serve plan-change feature) and the remaining §8 operator cancel/deactivate edge
cases (live-sub immediate B1, period-end B2 — only the dead-sub +2 case was verified).

### §11 full booking + fee loop — ✅ PASS (2026-06-29)
The complete value loop ran clean end-to-end on prod (operator cd / Chicken Dinner): call →
press-1 consent → AI vetting → service-area **radius** check (08821 in 30mi of 08820) →
business-hours-aware weekday slot (weekend/after-hours refused) → **reserve (held, no calendar
event yet)** → short branded payment link (`api.keeprsteady.com/pay/:id` → 302 to Stripe) → pay
(test card) → `payment_intent.succeeded` Connect webhook → `confirmPaidBooking` creates the Google
Calendar event + personalized confirmation SMS → **caller replies with full property address →
`collect_service_address` patches it onto the invite's location** → graceful close. Plus: 30-min
unpaid-hold sweeper (Railway cron, verified `{released:N}`), turn-cap scoped to the current
engagement, and the operator's **deposit ($250) + payout (net of our fee + Stripe)** surfaced on
the dashboard / calendar / email (commit `1684641`).

**Infra wired this session:** Stripe Connect enabled + platform-profile loss-liability completed;
`/connect/sync` + "Recheck status" (pull capability flags without waiting on a webhook); Connect
webhook endpoint (`account.updated` + `payment_intent.*` + `charge.refunded`) with
`STRIPE_CONNECT_WEBHOOK_SECRET`; booking-holds cron repointed to `/v1/internal/booking-holds/release`
(was firing the reminder URL by mistake).

**Known follow-ups (not blocking):** the `/booking/result` post-payment page needed a Next-16
`await searchParams` fix (uncommitted at time of writing); appointment-invite configurability
backlog (conversation link on invite, per-operator visit duration, multi-truck capacity) — see the
"Appointment / invite configurability backlog" section.

### Launch-readiness session — 2026-06-17 (while A2P campaign in review)

Code-only hardening done while waiting on carrier campaign approval. All API
typecheck clean. **Not yet committed/deployed** (see uncommitted list — these
land with the next push).

- ✅ **Billing dedup** — `billing.service.ts`: live-subscription guard blocks a
  second Checkout (double-bill prevention). Routes to billing portal instead.
- ✅ **Past-due degraded mode** — `advance.service.ts`: skips AI booking + fee
  when the operator isn't in good standing, sends one deduped polite handoff
  (CLAUDE.md §9.5 Flow A).
- ✅ **Security** — `main.ts`: `trust proxy = 1` (fixes per-IP throttling behind
  Railway) + `Permissions-Policy` header. Audit confirmed rate-limiting +
  CORS + helmet were already comprehensive (hardening-doc note was stale).
- 🔶 **STOP/HELP resilience (partial)** — `twilio.service.ts`: `sendSms` now
  catches Twilio 21610 (recipient opted out) and returns `{skipped:'opted_out'}`
  instead of throwing (no loud error / no webhook retry loop). **Still open**
  (needs live messaging or a migration): audit whether Twilio forwards
  STOP/HELP vs intercepts; DB-level opt-out tracking + a conversation
  `opted_out` outcome; branded HELP/STOP copy that preserves per-operator
  `from`. Tracked as session task #1.

**Skipped this session:** Notifications (Slice 10) — user deprioritized.

---

## ✅ Shipped

### Skeleton (2026-05-05)
- Monorepo: pnpm 9 workspaces + Turborepo 2.1
- Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `.npmrc`, `.nvmrc`, `.env.example` matching every var in CLAUDE.md §7
- `packages/config`: shared eslint flat configs (base/node/next), tsconfig presets, prettier preset
- `packages/shared`: empty stub for future zod schemas/types/constants
- `apps/api`: NestJS skeleton, `GET /v1/health`
- `apps/web`: Next.js 15 App Router placeholder landing page
- `supabase/config.toml`

### Foundations slice 1 (2026-05-05)
- **Env validation** — `apps/api/src/config/env.ts` with full §7 zod schema; production refuses to boot on missing required vars; `ENCRYPTION_KEY` accepts comma-separated `<v>:<hex>` for rotation. ConfigModule (global) exposes `Env` via `ENV_TOKEN`.
- **Logger** — nestjs-pino LoggerModule with §11.5 redaction paths (Twilio From/To/Body, `*.phone/*.email/*.refresh_token/*.access_token`, auth/Twilio/Stripe headers). JSON in prod, pretty-printed in dev. `/v1/health` excluded from request logs.
- **Error hierarchy** — `AppError` base + `Validation/Unauthorized/Forbidden/NotFound/Conflict/RateLimit/ExternalService/WebhookSignature` subclasses with stable `code`/`status`/`detail`/`extensions`.
- **RFC 7807 filter** — Global `ProblemDetailsFilter` emits `application/problem+json`; maps AppError, ZodError, HttpException, unknown throws (sanitized to 500 "unexpected error"). Warns for 4xx, errors for 5xx.
- **EncryptionService** — AES-256-GCM, wire format `v<N>:<iv_b64>:<tag_b64>:<ct_b64>`. Multi-key decrypt support for rotation; constructor tolerant of missing keys in dev (deferred error on actual use). 7/7 unit tests pass.
- **Bootstrap** — `dotenv` loads `.env.local` then `.env` at startup; production relies on platform-injected env.

### Slice 2 — Database foundations (2026-05-05)
- **Migration 0001 — init schema** — All §8 tables (`categories`, `operators`, `twilio_numbers`, `calendar_connections`, `conversations`, `messages`, `appointments`, `payments`, `webhook_events`, `audit_log`) with enums, FKs, CHECKs (E.164 phone format, fee≥0, `application_fee_cents ≤ amount_cents`, scheduled-range validity), indexes for dashboard queries, `set_updated_at` trigger function. `unique (source, event_id)` on `webhook_events` is the idempotency key.
- **Migration 0002 — RLS policies** — `auth_operator_id()` helper. `operators`: SELECT/UPDATE own; `appointments/conversations/messages/payments/calendar_connections`: SELECT-own only. `webhook_events/audit_log/twilio_numbers/categories`: RLS on, no policy → service-role only.
- **Migration 0003 — seed categories** — 5 launch categories per §16 (plumbing, hvac, electrical, roofing, garage_door). Vetting question stubs included; `system_prompt_template` is a placeholder, replaced in Slice 7.
- **`packages/db-types`** — workspace package with hand-written stub `Database` type covering rows we touch in Slice 2. Replaced wholesale by `pnpm gen:db` once Docker is up.
- **Root scripts** — `pnpm gen:db`, `pnpm db:migration:new`, `pnpm db:reset`.
- **`SupabaseService`** — service-role client (api-only). Constructor tolerant of missing creds (deferred-error pattern matching EncryptionService). `auth.persistSession` and `autoRefreshToken` disabled (server context).
- **`WebhookIdempotencyService`** — `record/markProcessed/markFailed` API. Detects PG `23505` to return `{status:'duplicate'}`. 4 unit tests with a mock Supabase client.
- **Test helpers** — `apps/api/test/helpers/tenants.ts` provisions N independent operator+user fixtures via the admin API and returns RLS-bound clients. `describeIfSupabase` skips tests when env vars are absent.
- **RLS regression scaffold** — `apps/api/test/rls.spec.ts` with 3 cases (own-row visible, other-tenant-invisible, webhook_events invisible). Currently skipped pending live Supabase; will run unattended in CI once Slice 12 wires up an ephemeral Supabase test project.
- **TS config split** — `tsconfig.json` (typecheck + tests, no rootDir), `tsconfig.build.json` (nest build, src/ only). nest-cli.json points to the build config so test files don't end up in `dist/`.
- **Status** — typecheck clean · 11 passed + 3 skipped tests · `nest build` succeeds · API boots and `/v1/health` responds.

### Slice 3 — Auth + operators (2026-05-06)
- **Local stack live** — Docker Desktop installed; `supabase start` boots the full local stack; `pnpm gen:db` generates real `Database` types from the live DB (replaces hand-written stub). Migrations renamed to 14-digit timestamps (`20260505000001_*` etc.) — Supabase CLI parses everything before the first `_` as version, so the original `<date>_<seq>_<name>` convention from CLAUDE.md §8 collapses three files to one version. CLAUDE.md §8 example needs updating in the next doc PR.
- **Jest env loading** — `apps/api/test/setup-env.ts` + `setupFiles` in jest config so `.env.local` is loaded; flips the RLS regression suite from skipped → live (no longer needs Slice 12 to activate locally).
- **Auth primitives** (`apps/api/src/common/auth/`) — `JwtVerifierService` delegates to `supabase.auth.getUser(token)` (handles both legacy HS256 and current ES256/JWKS — local Supabase issues ES256 now). `AuthGuard` Bearer extraction → `AuthedRequest.user`. `@CurrentUser()` param decorator. `@Global` `AuthModule` exports both.
- **`ZodBodyPipe`** (`common/pipes/`) — generic body validation; surfaces `ValidationError` with structured `issues` extension.
- **Operators module** (`modules/operators/`) — `OperatorsService` (getByUserId, update with FK→400 / unique→409 mapping, getOnboardingStatus). Controller: `GET/PATCH /v1/operators/me`, `GET /v1/operators/me/onboarding-status`. `UpdateOperatorSchema` zod DTO is `.strict()`, validates IANA timezone, business_hours `{day: [{start,end}]}`, refines `booking_fee_enabled ⇒ booking_fee_cents`. Service rejects the same fee-without-cents condition defensively for partial-patch sequences.
- **Me module** (`modules/me/`) — `GET /v1/me` returns `{id, email, created_at}` via `auth.admin.getUserById`. `PATCH /v1/me` updates email via `auth.admin.updateUserById` (Supabase sends confirmation).
- **Cross-tenant isolation suite** (`apps/api/test/cross-tenant.spec.ts`) — supertest against the test app under two separate user JWTs. 12 cases: own-row visible, B not leaked under A's token, 401 on missing/malformed token, PATCH updates only caller's row, strict zod rejects unknown fields, fee-without-cents → 400, unknown category slug → 400 (FK violation surfaced), known seed slug accepted, onboarding-status shape, `/v1/me` happy path + 401. Helper `setupTenants` now exposes the access token alongside the authed client.
- **AppModule wiring** — registers `AuthModule`, `MeModule`, `OperatorsModule`. Both feature modules import `SupabaseModule` per existing convention.
- **Status** — typecheck clean · 26/26 tests pass (was 11+3) · dev server smoke: `/v1/me` 401, `/v1/operators/me` 401, `/v1/health` 200.

### Slice 4 — Billing (BookingBlues SaaS subscription) (2026-05-06)
- **Stripe SDK + raw-body wiring** — `apps/api/src/common/stripe/{stripe.module,stripe.service}.ts`. `StripeService` is constructor-tolerant (deferred error like Supabase/Encryption). Exposes `client()`, `connect(stripeAccountId)` (Slice 8), `verifyPlatformWebhook`, `verifyConnectWebhook`. `NestFactory.create({ rawBody: true })` so `/webhooks/*` handlers can read `req.rawBody` for signature verification. `setGlobalPrefix('v1', { exclude: [{ path: 'webhooks/(.*)', method: ALL }] })` keeps webhooks unprefixed per CLAUDE.md §10.
- **Billing module** (`modules/billing/`) — `BillingService` lazily creates the operator row on first checkout (defaults `business_name` to provided name, then email local-part, then "New Business") and lazily creates the Stripe customer (stamps `stripe_customer_id` back on the operator). `createCheckoutSession` builds a subscription-mode session per CLAUDE.md §9.1: `client_reference_id = operator.id`, `payment_method_collection = 'always'`, `subscription_data.trial_period_days = TRIAL_DAYS`, `subscription_data.trial_settings.end_behavior.missing_payment_method = 'cancel'`. `createPortalSession` requires an existing `stripe_customer_id` (409 otherwise).
- **Endpoints** — `POST /v1/billing/checkout-session` (`{plan: 'starter'|'pro', business_name?}`) → `{url}`. `GET /v1/billing/portal-session` → `{url}`. Both Bearer-guarded.
- **Platform Stripe webhook** — `POST /webhooks/stripe` (`StripePlatformController`). Verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET`, records via `WebhookIdempotencyService` (`unique (source, event_id)` dedupes retries), dispatches via pure `dispatchPlatformEvent`. Handlers: `checkout.session.completed` (links `stripe_subscription_id` to operator by `client_reference_id`); `customer.subscription.{created,updated}` (looks up operator by `stripe_customer_id` and writes `subscription_status` + `trial_ends_at`); `customer.subscription.deleted` (status → `canceled`); `customer.subscription.trial_will_end` (TODO email — wired in Slice 10 Resend); `invoice.payment_{succeeded,failed}` (no-op; status arrives via subscription.updated).
- **Stripe → DB enum mapping** — `mapSubscriptionStatus` covers all 8 Stripe states; `unpaid → past_due` and `paused → canceled` (we don't model paused yet).
- **Tests** — 8 parameterised unit cases for `mapSubscriptionStatus` + 5 integration cases against real Supabase: unsigned → 400, bad signature → 400, valid `subscription.created` → operator status `trialing` and `trial_end` populated, idempotent re-delivery preserves first-write values (different sub id in second payload is ignored), unrelated tenants untouched. Total **39/39 pass** (was 26).
- **Smoke** — `POST /v1/billing/checkout-session` 401, `GET /v1/billing/portal-session` 401, `POST /webhooks/stripe` 400 (no sig), `/v1/health` 200.

### Slice 5 — Telephony (2026-05-06)
- **Twilio SDK wrapper** (`apps/api/src/common/twilio/{twilio.module,twilio.service}.ts`) — constructor-tolerant in dev. `client()`, `validateSignature({signatureHeader, fullUrl, formParams})` (delegates to Twilio's HMAC-SHA1), `sendSms({from, to, body})` with §11.12 outbound allowlist: in non-prod, `to` MUST be in `OUTBOUND_SMS_ALLOWLIST` (comma-separated E.164) — unset = block-all (fail-safe). Production ignores the allowlist.
- **Env additions** — `OUTBOUND_SMS_ALLOWLIST` zod-optional. Mirrored in `.env.example`.
- **Number provisioning** (`modules/telephony/`) — `POST /v1/operators/me/twilio-number {area_code?}` searches local US numbers (optionally area-code-filtered), purchases via `incomingPhoneNumbers.create` with voice/sms webhook URLs pointing at `${API_URL}/webhooks/twilio/{voice,sms}/${operatorId}`, inserts into `twilio_numbers` (status='assigned'), links onto `operators.twilio_number_{e164,sid}`. 409 if operator already has a number; logs loudly + 500 if Twilio purchase succeeded but DB writes failed (manual reconciliation expected).
- **Conversations module** (`modules/conversations/`) — `getOrCreate(operatorId, callerPhone)` returns the most recent non-terminal conversation or creates a new `awaiting_bot` row. `appendMessage({conversationId, role, body, twilioMessageSid?})` inserts and bumps `last_message_at`. Slice 7 owns the full state machine (CLAUDE.md §12).
- **Voice webhook** (`POST /webhooks/twilio/voice/:operatorId`) — verifies `x-twilio-signature` against `${API_URL}${req.originalUrl}`, resolves operator + verifies `To == operator.twilio_number_e164` (§11.10), records via `WebhookIdempotencyService` keyed on `CallSid` (source='twilio'), inline side-effect: `conversations.getOrCreate` + outbound opening SMS via `twilio.sendSms` + `appendMessage(role='bot', sid)`. Always returns the §9.2 TwiML greeting (escapes XML special chars in business name); side-effect failure is logged but the caller still gets the greeting (Slice 7 worker can retry).
- **SMS webhook** (`POST /webhooks/twilio/sms/:operatorId`) — same signature/operator/To checks. Records keyed on `MessageSid`, persists inbound `role='caller'` message via `appendMessage`. Returns empty `<Response/>`. Slice 7 will enqueue the AI advance job here.
- **Tests** — 3 unit cases for `escapeXml` + 5 integration cases for the SMS webhook (no signature → 400, tampered signature → 400, To mismatch → 403, valid signed request persists message + creates conversation, replay of same MessageSid is a no-op). Helper `signTwilioRequest` computes the canonical Twilio HMAC-SHA1 over `url + sortedKey+value...`. Total **47/47 pass** (was 39).
- **Smoke** — `POST /v1/operators/me/twilio-number` 401 (no auth), webhook 500 with no Twilio creds in dev `.env.local` (by design — config error is loud rather than silent), `/v1/health` 200.

### Slice 6 — Calendar (2026-05-06)
- **`google-auth-library`** added (lighter than full `googleapis`; we hit `freeBusy` and `events.insert` directly via `fetch`).
- **State CSRF token** (`modules/calendar/calendar-state.ts`) — `<userId>.<expiry>.<nonce>.<hmac_sha256>` signed with `SUPABASE_JWT_SECRET`. 10-min TTL, timing-safe equality, rejects tamper/expiry/wrong-secret/malformed. 5 unit tests cover all branches.
- **`GoogleOAuthService`** — `authUrl(state)` (scopes `calendar.events`, `calendar.readonly`, `userinfo.email`; `access_type=offline`, `prompt=consent` to guarantee a refresh token on every connect). `exchangeCode(code)` returns `{refreshToken, accessToken, expiresAt, scopes, email}`; throws `google.no_refresh_token` if Google omits it. `refreshAccessToken(refreshToken)` for token refresh. Tolerant constructor (deferred error like Stripe/Twilio).
- **`CalendarService`** — `getConnection`, `upsertConnection` (encrypts refresh_token via `EncryptionService`, stamps `operators.google_calendar_id='primary'` + `connected_at`), `disconnect` (overwrites refresh_token with sentinel + status='revoked' + clears operator pointer), `markRevoked`, `getFreshAccessToken` (returns cached if >60s remaining; otherwise refreshes and updates cache; on `invalid_grant` calls `markRevoked` per CLAUDE.md §9.4), `freeBusy({operatorId, windowStart, windowEnd, timeZone})` (proxy to Google's REST API; 401 → markRevoked + ExternalServiceError), `insertEvent({summary, start, end, timeZone, attendeeEmails})` (with `sendUpdates=all` per §9.4).
- **Endpoints** — `POST /v1/operators/me/google/connect` → `{url}` (Bearer-guarded). `POST /v1/operators/me/google/disconnect` → `{ok:true}`. `GET /webhooks/google/oauth/callback?code&state[&error]` — verifies state, exchanges code, upserts connection, redirects to `${APP_URL}/onboarding/calendar?(connected=google|error=…)`. Webhook path is unprefixed per CLAUDE.md §10.
- **Smoke** — connect/disconnect 401 unauth, callback with no params returns 302 → `…/onboarding/calendar?error=missing_code_or_state`.
- **Status** — typecheck clean · **52/52 tests pass** (was 47).

### Slice 7 — AI + conversations (2026-05-06)
- **OpenAI SDK** (`apps/api/src/common/openai/`) — deferred-error pattern; model `gpt-4.1` per CLAUDE.md §9.3. `OpenAIService.client_()` exposes the underlying client.
- **Prompt assembly** (`modules/ai/prompts.ts`) — static frame (rules, persona, refusal policy, prompt-injection defense per §11.16) + per-operator block (business name, category, timezone, now, fee policy) + per-category template from `categories.system_prompt_template`. `wrapCallerMessage(body)` wraps caller text in `<<CALLER_MESSAGE>>...<<END>>` so the model knows it is untrusted data.
- **Tool definitions** (`modules/ai/tool-definitions.ts`) — JSON-schema definitions for the 7 tools per §9.3 (`check_availability`, `propose_slots`, `book_appointment`, `request_payment_link`, `mark_out_of_scope`, `mark_spam`, `escalate_to_human`) plus zod schemas for runtime arg validation. ISO 8601 with offset enforced for all datetime args.
- **Tool handlers** (`modules/ai/tool-handlers.ts`) — implementation for each tool. `book_appointment` inserts into appointments, then calls `calendar.insertEvent({...sendUpdates:'all'...})`; on calendar failure the appointment row is rolled back to `cancelled`. `request_payment_link` is a stub returning `fee_collection_unavailable` (Slice 8 wires real Stripe Connect Direct Charges Checkout). `mark_out_of_scope`/`escalate_to_human` send a polite handoff SMS; `mark_spam` is silent (`silentTerminate: true`).
- **Slot dedup** (`supabase/migrations/20260506000001_slot_dedup_unique.sql`) — partial unique index `(operator_id, scheduled_for_start) where status in ('proposed','confirmed')`. CLAUDE.md §17 specifies a Postgres advisory lock; the partial unique index gives the same race-protection with simpler semantics — concurrent winners insert, losers see 23505 which the bot translates into "that slot was just taken — pick another."
- **AdvanceService** (`modules/ai/advance.service.ts`) — orchestrates the OpenAI loop. Loads operator, category, conversation history (caller↔assistant text turns only — tool calls don't persist across advances). Caller-turn cap (`MAX_CALLER_TURNS = 20`, §9.3) forces `escalate_to_human` when reached. Inner loop iterates up to `MAX_TOOL_ITERATIONS = 5` per advance. Terminal tool result transitions conversation to `completed`/`escalated` with outcome; non-terminal sets `awaiting_caller`. Outbound SMS sent via `TwilioService.sendSms` (which itself enforces §11.12 allowlist in non-prod).
- **SMS webhook integration** — `TwilioSmsController` now: 1) records inbound + acks idempotency (this part fails the webhook → Twilio retry), 2) best-effort calls `advance.advance` in a try/catch (this part swallows errors with a log so a missing `OPENAI_API_KEY` in dev or transient OpenAI 5xx don't trigger Twilio retry-loops). Eventually-consistent: failed advances need manual replay until pg-boss queue lands.
- **Tests** — 5 prompt-assembly cases + 5 tool-arg validation cases. **62/62 pass** (was 52).
- **Status** — typecheck clean. Dev server at `:3001` healthy.

### Slice 8 — Payments (Stripe Connect Direct Charges) (2026-05-06)
- **Pricing** (`modules/payments/pricing.ts`) — `computeApplicationFee({amountCents, takeRateBps, minPlatformFeeCents})` returns `{applicationFeeCents, clampedToCap, capCents}`. Caps at `amount - (amount * 0.029 + 30)` (Stripe US standard processing) — Stripe rejects DC charges where `application_fee_amount > amount - processing_fee` (CLAUDE.md §9.5). 5 unit tests cover floor/percent dominance, tiny-amount clamp, zero/negative, custom take rate.
- **Connect onboarding** — `POST /v1/operators/me/connect/onboarding-link` (Bearer-guarded). Creates a Stripe Express account on first call (`type='express'`, `country='US'`, requested capabilities `card_payments` + `transfers`, metadata links operator + user), stamps `operators.stripe_connect_account_id`, then issues an `accountLinks.create` for `account_onboarding`. Returns `{url}` for the web app to redirect into.
- **`PaymentsService.ensureFeeEligible(operatorId)`** enforces all four CLAUDE.md §9.5 gates (fee enabled + cents set, subscription `trialing`/`active`, `stripe_connect_account_id` present, both `charges_enabled` and `payouts_enabled` true). Throws `ValidationError` with the specific failed gate.
- **`PaymentsService.createBookingFeeCheckout({operatorId, appointmentId})`** — creates a Direct Charges Checkout Session **on the connected account** (`{stripeAccount}` second arg) with `payment_intent_data.application_fee_amount` from the pricing service. Inserts a `payments` row in `pending` keyed on the PI id, stamps `appointments.fee_payment_intent_id`/`fee_checkout_session_id`/`fee_status='pending'`. 23505 on the unique PI id surfaces as 409.
- **`PaymentsService.refundBookingFee(paymentId, reason?)`** — `refunds.create({payment_intent, refund_application_fee:true, reverse_transfer:false}, {stripeAccount})` per §9.5. Updates payment + appointment to `refunded`. Validates payment is currently `succeeded`.
- **Connect webhook** (`/webhooks/stripe/connect`) — verifies via separate `STRIPE_CONNECT_WEBHOOK_SECRET`, requires `event.account` (envelope's connected account id), idempotent via `webhook_events` with `source='stripe_connect'`. Handlers cross-reference `event.account` against `payments.stripe_connected_account_id` / `operators.stripe_connect_account_id` per §11.13 — mismatch is rejected. Dispatches: `account.updated` (mirrors `charges_enabled`/`payouts_enabled` to the operator row), `payment_intent.succeeded` (flips payment + appointment to `succeeded`/`paid`), `charge.refunded` (handles full + partial refunds).
- **AI tool wiring** — `request_payment_link` is no longer a stub; calls `PaymentsService.createBookingFeeCheckout` and returns `{url, payment_id}` to the model PLUS attaches `outboundMessage` so the SMS goes out even if the model paraphrases. On eligibility failure (any gate), returns `{error:'fee_unavailable', message}` so the model continues without a fee.
- **Smoke** — `POST /v1/operators/me/connect/onboarding-link` 401 unauth, `POST /webhooks/stripe/connect` 400 (no sig).
- **Status** — typecheck clean · **67/67 tests pass** (was 62).

### Slice 9 — Web app (2026-05-06)
- **Foundation** — Tailwind 3.4 set up (`tailwind.config.ts`, `postcss.config.js`, `app/globals.css`, custom palette `ink/paper/muted/accent`). `lib/env.ts` zod-validates `NEXT_PUBLIC_*` at module load. `@supabase/ssr` browser + server helpers. `lib/api.ts` exposes `api()` (raw) and `apiAsUser()` (resolves session via server client and attaches Bearer). `apps/web/.env.local` lives separately from the monorepo root because Next.js only auto-discovers env in the app dir.
- **Auth** — `middleware.ts` runs `supabase.auth.getUser()` (which refreshes expired access tokens, writing fresh cookies on the response), redirects unauth → `/login?next=…`, and bounces signed-in users away from `/login`/`/signup`. `AuthForm` (client component) does email+password sign-in/sign-up via `@supabase/ssr` browser client. `SignOutButton` clears the session and refreshes the route tree.
- **Dashboard layout + page** — `(dashboard)/` group with `Nav` (current email + sign-out + section links). `/dashboard` server-renders 4 KPI cards (conversations, booked, appointments, fee revenue this month), recent conversations table, and upcoming appointments table — phone numbers masked to last 4 (CLAUDE.md §11.5). If the operator row doesn't exist yet, redirects the user to onboarding instead.
- **Onboarding wizard** — `/onboarding` 6-step page (`Wizard` client component): subscribe (`/v1/billing/checkout-session`), category (`PATCH /v1/operators/me`), Twilio number (`POST /v1/operators/me/twilio-number`), Google Calendar (`POST /v1/operators/me/google/connect` → redirect), Stripe Connect (`POST /v1/operators/me/connect/onboarding-link` → redirect), booking fee (`PATCH /v1/operators/me`). Step status derived live from operator row.
- **Settings** — `/settings` covers business name, timezone, fee on/off + amount, Google disconnect, billing portal launch (`GET /v1/billing/portal-session`). Subscription status surfaced.
- **Marketing** — `(marketing)/` group with shared header (Sign in / Get started CTAs). `/` hero + 3-feature pitch, `/pricing` Starter $49 / Pro $149, `/faq` 5 entries.
- **API additions** — `DashboardModule` adds `GET /v1/dashboard/metrics` (this-month counts derived per-tenant), `GET /v1/conversations` (last 50, last_message_at desc), `GET /v1/appointments` (last 50 by scheduled_for_start). All Bearer-guarded; 404 when no operator yet.
- **Smoke** — `/`, `/pricing`, `/faq`, `/login`, `/signup` 200. `/dashboard`, `/settings`, `/onboarding` 307 → `/login?next=…`. `/v1/dashboard/metrics`, `/v1/conversations`, `/v1/appointments` 401 unauth. Tests still **67/67**.

### UX-followup: loading states across the rest of the app
Onboarding wizard now disables every async button + shows a "Saving…" /
"Opening checkout…" label while the request is in flight (real bug:
double-click on Twilio provisioning created an orphan number in QA).
The same treatment is needed everywhere else a button fires a network
call:

- [ ] `SettingsPanel` — Save profile, Disconnect Google, Open billing portal
  (currently has a single `busy` string state — works but not per-action)
- [ ] `TrialBanner` — Fix payment method (portal launch) + End-trial-now (modal
  has its own busy already; double-check)
- [ ] `AuthForm` — already has `busy` ✓
- [ ] `SignOutButton` — already has `busy` ✓
- [ ] `ConfirmModal` — already has `busy` ✓
- [ ] All future client buttons should follow the same pattern: per-key busy
  set + disabled prop + "Working…" label, OR adopt a shared `useAsyncAction(key, fn)`
  hook to avoid repetition

### Slice 9-followup
- [ ] Dashboard `/conversations/:id` view (full transcript)
- [ ] Appointments `PATCH /v1/appointments/:id` + cancel UI
- [x] **Business hours editor** (✅ 2026-06-26) — `SettingsPanel` "Business hours" card: per-day open/close toggle + start/end `<input type=time>`, one interval/day, PATCHes `business_hours` to `/v1/operators/me`. Closed days omitted. Unblocks `check_availability` (operators with empty `business_hours: {}` got no slots).
- [ ] Carrier-specific conditional-forwarding instructions in onboarding step 3 (CLAUDE.md §17 carriers vary)
- [ ] Marketing pages design polish, real copy, OG images

### Hardening — comprehensive pre-launch pass (multi-day, run before Slice 13/14 cutover)
Goal: everything non-product-feature — security, observability, CI/CD discipline, auto-scanning, secret hygiene, ops runbooks. Each phase has a checkpoint; surface findings as we go, don't batch a single report.

**Phase 0 — Discovery (✅ 2026-05-06)** — see `docs/HARDENING_PHASE_0_FINDINGS.md`
- [x] Surfaces, CI, secrets inventoried (35 env vars, 2 deployables)
- [x] `pnpm audit` baseline: **35 vulns · 2 critical · 10 high** — both criticals are `next@15.0.0` (middleware-bypass + RCE), patched in 15.2.3
- [x] Git-history secret sweep clean (3 commits, no remote, only false-positive on empty `.env.example` placeholder)
- [ ] Production header `curl -sI` deferred until Railway staging is up (Slice 13)
- **Open questions for human** at end of findings doc — answer before Phase 1

**Phase 1 — Code-level security review (~½ day)** → `docs/SECURITY_REVIEW.md`
- [ ] Severity-ranked findings table (file:line, status)
- [ ] Auth review: password hashing/JWT signing/refresh-token rotation/session revocation/login timing/audit-log coverage
- [ ] Crypto review: AES-256-GCM IV+tag handling (we already have `EncryptionService`), key derivation, decrypt failure shape
- [ ] Authorization route-coverage matrix (every protected route → guard; every mutation → rate-limit)
- [ ] OWASP Top 10 walkthrough with file:line evidence
- [x] Rate-limit coverage audit — **IS implemented** (audit 2026-06-17; the earlier "NOT implemented" note was stale). `@nestjs/throttler` global `ThrottlerGuard` (60/min default), webhooks `@SkipThrottle()` (Twilio/Stripe/Slack/cron — they retry/burst), admin 30/min read & 10/min write, leads 10/min, `/me` PATCH 5/15min. **Fixed 2026-06-17:** added `app.set('trust proxy', 1)` so per-IP keying works behind Railway's proxy (without it all clients shared one bucket).
- [x] CORS + helmet config review — already wired in `main.ts` (single-origin CORS off `env.APP_URL`, helmet HSTS preload 2yr + includeSubDomains, frameguard deny, referrer-policy, x-powered-by off, CSP off for JSON API). **Added 2026-06-17:** `Permissions-Policy` header (helmet omits it; §11.20).
- [ ] Prioritized fix list with diffs

**Phase 2 — CI/CD plumbing (~½ day)** → `docs/CI_AND_BRANCH_PROTECTION.md`
- [ ] `.github/workflows/ci.yml` (lint + typecheck + test + build + `pnpm audit --audit-level=high`)
- [ ] `codeql.yml` (security-extended)
- [ ] `trivy.yml` (Docker image CVE — strict on push, soft on PRs)
- [ ] `secret-scan.yml` using bare gitleaks binary (NOT gitleaks-action — fails on Dependabot read-only token)
- [ ] `snyk.yml` (Service Account token, not UAT)
- [ ] `.github/dependabot.yml` (npm + actions; group minor/patch)
- [ ] Branch protection rules doc (manual UI step)
- [ ] Required GitHub secrets list
- [ ] **Gotchas to pre-empt:** pnpm/action-setup version-collision (use `packageManager` only), Dependabot read-only token (gate SARIF uploads to push-to-main), TS strict + monorepo `@types/node` per-package

**Phase 3 — Observability (~½ day)** — Sentry across all surfaces
- [ ] Init early (Node ESM: `--import ./instrument.js`); init both `apps/api` and `apps/web`
- [ ] PII filter in `beforeSend`/`beforeSendTransaction` — recursive walk of `request`/`extra`/`contexts`, redact keys matching CLAUDE.md §11.5 paths + Twilio body fields, OpenAI prompts/completions, Stripe metadata
- [ ] `request_id` tag from existing pino correlation id
- [ ] No-op when `SENTRY_DSN_*` empty
- [ ] Test with deliberate throws, then DELETE the test code
- [ ] Dotenv load-order: ensure config loads before any module reads `process.env.SENTRY_DSN`

**Phase 4 — Operational hygiene (~few hours)**
- [ ] Branded transactional email templates (Gmail-safe inline styles, table layout, light-mode-locked) — for Resend in Slice 10
- [ ] `docs/RUNBOOK_ENCRYPTION_KEY_ROTATION.md` (we already have versioned ciphertext format `v<N>:iv:tag:ct` — runbook covers add-old-key, dry-run, swap, verify, remove)
- [ ] CORS lockdown — production origin allowlist with no localhost; document each allowed origin
- [ ] Production header posture (HSTS preload, strict CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy) on both API and Web
- [ ] Token discipline — CI tokens never in `.env`; rotation calendar reminders

**Phase 5 — Auto-generated security report (~few hours)**
- [ ] `.github/workflows/security-report.yml` runs on push-to-main + weekly cron
- [ ] Aggregate `pnpm audit` + gitleaks + Trivy + CodeQL (`gh api`) + Dependabot alerts + production header snapshot into single Markdown
- [ ] Output to `$GITHUB_STEP_SUMMARY` + 90-day artifact
- [ ] v2: commit each report to `security-reports` branch (avoid main push-loop)

**Phase 6 — Third-party penetration test (pre-launch GO/NO-GO gate)**
Independent external validation before we hold real operator + caller PII and
move live money. Run AFTER Phases 1–5 land — fixing our own findings first is
far cheaper than paying a firm to rediscover them. Test against the staging
environment with production-equivalent config (Slice 13). Hand the tester this
checklist + CLAUDE.md §11 as the control list.
- [ ] Engage a reputable firm or vetted independent tester; MSA + NDA; agree
      rules of engagement, test window, and an emergency contact
- [ ] Seed the engagement: staging URLs, **two** operator accounts (for
      cross-tenant probing), one admin account, Stripe/Twilio **test-mode**
      creds — never live keys
- [ ] **Multi-tenant isolation / IDOR** — JWT manipulation + object-id
      enumeration against `/v1/operators/me`, `/v1/conversations/:id`,
      `/v1/appointments/:id`, `/v1/admin/*`. Baseline is our cross-tenant
      suite (§11.11); the test should try to break past it.
- [ ] **RLS bypass** — confirm the anon/authenticated keys cannot read another
      tenant's rows via crafted PostgREST queries (§11.3, §11.18); confirm the
      service-role key never reaches the browser bundle
- [ ] **Webhook forgery + replay** — Twilio / Stripe / Stripe-Connect / Slack /
      Google signature verification, idempotency via `webhook_events`, and the
      Connect `account`↔`operators.stripe_connect_account_id` cross-check
      (§11.1, §11.2, §9.5)
- [ ] **Auth + privilege escalation** — Supabase JWT verification, magic-link /
      password-reset abuse, admin-role escalation (verify `app_metadata.role`
      is server-only-writable, ADR 0009), and that the **terms-acceptance gate
      can't be bypassed** to enter the app without consent
- [ ] **Payment / MoR boundary** — no code path holds caller funds; the
      `Stripe-Account` header is present on every Connect call;
      `application_fee_amount` can't be tampered to over/under-charge (§9.5,
      ADR 0005)
- [ ] **AI prompt injection** — caller SMS attempting to leak the system
      prompt, invoke tools out of policy, book out of scope, or reach another
      tenant's data (§9.3, §11.16, §11.17)
- [ ] **PII exposure** — logs, RFC-7807 error bodies, and Sentry events
      confirmed to redact phone/email/message-body per §11.5
- [ ] **Rate-limit / abuse** — auth + write endpoints (§11.7), outbound-SMS
      abuse, and signup/trial farming (§17: dedupe by verified phone, block
      disposable email)
- [ ] **Transport + headers** — HTTPS, HSTS preload, CSP, and Secure /
      HttpOnly / SameSite cookie flags (§11.20)
- [ ] Triage report: severity-ranked. **Fix all Critical + High before
      go-live**; ticket Medium/Low with owners + dates
- [ ] Retest Critical/High fixes; obtain written sign-off / attestation letter
      (useful for enterprise sales + cyber-insurance)
- [ ] Set a recurring cadence: annual, plus after any material change to auth,
      payments, or the webhook surface

### Service-area follow-up: city/town centers via Google Maps Geocoding (Phase C)
Today the operator can express service area as (a) explicit ZIPs and (b) radius
zones around a center ZIP. Phase C adds:
- Operator types "Pasadena, CA" or "Austin, TX" instead of a center ZIP
- Server calls Google Maps Geocoding API to resolve to lat/lng, then runs the
  same haversine math to expand into the implied ZIP set
- Same denormalized output: ZIPs the AI sees in its prompt

**Blocked on:** waiting on Google to allow more projects on the user's billing
account. Once approved:
- Enable **Geocoding API** in `bookingblues-staging` (already exists for Calendar OAuth)
- Create an API-key credential restricted to **Geocoding API** + Railway egress IPs
- Add `GOOGLE_MAPS_API_KEY` to Railway api Variables
- Implement: extend `service_radius_zones` jsonb entries with `{kind: 'city'|'zip', value, radius_miles}`; service.expand caches geocoded results to limit API spend
- Free tier covers $200/month (~40k geocoding calls); after that $5/1000

Free fallback: **Nominatim (OpenStreetMap)** — no key, max 1 req/s/IP, attribute
OSM. Less accurate but acceptable for occasional operator setup.

### Slice 4-followup: billing flow gaps (surfaced during E2E 2026-05-07)
- [ ] **Trial → paid conversion test** — manually advance the trial via Stripe dashboard "Cancel trial / charge now", verify `customer.subscription.updated` flips status to `active`, dashboard reflects, no double-billing
- [ ] **Cancellation flow test** — operator clicks "Cancel" via Customer Portal (Settings → Billing → Open billing portal), verify `customer.subscription.deleted` → `subscription_status='canceled'`, dashboard banner, AI conversations gracefully degrade per §9.1 (greeting still plays, no booking, no fee). 7-day Twilio number grace then release.
- [x] **Duplicate-checkout dedup** (✅ 2026-06-17) — `BillingService.createCheckoutSession` now refuses when the operator has a live subscription (`stripe_subscription_id` set AND status in trialing/active/past_due/incomplete) with a `ConflictError` pointing to the billing portal. Re-subscribe is allowed only from terminal states (canceled / incomplete_expired / none). Prevents the double-bill from clicking "Start Trial" again after subscribing.
- [x] **Past-due degraded mode** (✅ 2026-06-17) — `AdvanceService.advance` now gates the AI loop on subscription standing. When status is not trialing/active, it sends ONE polite handoff SMS (deduped via a marker substring so repeat caller turns aren't re-notified) and skips booking + fee collection entirely (CLAUDE.md §9.5 Flow A). Voice greeting + opening SMS are unaffected (voice-side).
- [ ] **Trial reminder emails** — day 3 (us, via pg-boss) + day 6 (us OR `customer.subscription.trial_will_end` via Stripe). Currently the webhook just logs; Slice 10 wires Resend.
- [ ] **Self-serve plan upgrade / downgrade (NET-NEW, requested 2026-06-25)** — operator
  changes plan (Solo ⇄ Crew ⇄ Fleet, and/or cadence) from the dashboard. Requirements:
  **(a) effective immediately** — swap the subscription item to the new price right away
  (not at period end); **(b) prorated refund of the earlier plan** — credit/refund the
  unused portion of the current plan for the remainder of the billing period.
  Implementation notes: Stripe `subscriptions.update` with `proration_behavior:'create_prorations'`
  (or `'always_invoice'`) computes the proration automatically; a downgrade yields a credit
  balance — decide refund-to-card vs credit-toward-next-invoice (user asked for a *refund* of
  the prorated earlier-plan fee, so issue the credit back to the card rather than just holding
  it). The active price ID already drives `plan`/`plan_cadence` via `planCadenceForPrice` +
  the `onSubscriptionUpserted` webhook, so the usage meter limit (`conversationLimitForPlan`),
  per-plan deposit policy, and platform take rate (`plan-policy.ts`) all re-resolve correctly
  on the next webhook with no extra work. Gate against the duplicate-checkout guard. Surface
  in Settings → Subscription (alongside the existing `PlanLine`). Mandatory-deposit rule
  (Fleet) must be re-applied on upgrade *into* Fleet (auto-enable booking fee) and is fine to
  leave enabled on downgrade.

### Monetization completeness (flagged 2026-06-24 during manual test §2) — VERIFY + BUILD
Three revenue mechanics to validate end-to-end and, where missing, build:
- [ ] **Deposit / booking-fee collection works E2E** — Stripe Connect Direct Charge
  (Slice 8) from `request_payment_link` → Checkout on connected account → caller pays
  → `payment_intent.succeeded` on `/webhooks/stripe/connect` → `appointments.fee_status='paid'`.
  Code exists; needs a real prod test (gated on Connect onboarding + the four eligibility
  gates, CLAUDE.md §9.5).
- [ ] **Platform fee (our cut) is computed AND collected** — the `application_fee_amount`
  on each Direct Charge. **Changed 2026-06-25:** the fee is now **per-plan (Solo 10% / Crew 15%
  / Fleet 20%, `plan-policy.ts`) charged ON TOP of the deposit and paid by the caller** — the
  caller pays `deposit + fee`, the operator keeps the full deposit, our fee is the
  `application_fee` (`computeBookingFeeCharge` in `payments/pricing.ts`; legacy/null plans fall
  back to env `PLATFORM_TAKE_RATE_BPS`). `MIN_PLATFORM_FEE_CENTS` floor $1.00 still applies.
  Onboarding Wizard + SettingsPanel breakdowns reflect this. **Still to verify in prod:** the
  amount is computed correctly per booking AND actually lands on the platform Stripe balance
  (not just the operator's connected account) after a test booking-fee payment.
- [ ] **AI-conversation metering is accurate** — current meter (2026-06-23) counts every
  conversation row in the operator's billing period, **display-only**, with a calendar-month
  fallback until `current_period_*` syncs from the Stripe webhook. Confirm the count matches
  reality and the period boundaries are correct after a subscription webhook fires.
- [ ] **Overage conversations: compute → communicate → bill (NET-NEW, likely unbuilt)** —
  when an operator exceeds their plan's included conversations (Solo 80 / Crew 500 /
  Fleet 1500), there is currently **no** overage computation, no operator-facing warning,
  and no billing. Needs: overage rate per plan, metered usage reporting to Stripe (usage
  records / metered price), threshold alerts to the operator, and dashboard surfacing.

### Slice 7-followup: pg-boss queue + delayed jobs (deferred from Slice 7)
- [ ] pg-boss setup, worker registration via `OnModuleInit`
- [ ] Replace synchronous `advance` call from SMS webhook with `queue.publish('conversation.advance', ...)`
- [ ] Workers: `conversation.advance`, `conversation.abandoned` (24h cron-style scheduling), `appointment.reminder` (1h before)
- [ ] Fee timeout (cancel `appointments` whose `fee_status='pending'` after a configurable window)
- [ ] Token-usage logging per advance (cost guardrail per CLAUDE.md §17 "OpenAI cost")

### Slice 7.5: Human-in-the-loop (HITL) via Slack — ✅ **shipped 2026-05-11**
The bot escalates to a human in Slack and stays bridged. The SMS channel never closes — Slack just becomes the operator's UI on the same conversation. The human can hand control BACK to the AI mid-thread when they're done, and the AI picks up the next caller message normally.

**Code complete; end-to-end test needs the Slack app to be created** via `docs/slack-app-manifest.yaml` + `docs/SLACK_SETUP.md`. Until then, the API serves the OAuth routes but no operator can actually install. The `escalate_to_human` tool still flips conversation status to `escalated` even when Slack isn't configured (no-op delivery + email fallback awaiting Slice 10).

**Triggers (both must be supported)**
- [x] AI-initiated: bot calls `escalate_to_human` (already exists in Slice 7) — auto-fires when bot is stuck (max-turn cap, calendar revoked, off-topic gray area, repeated tool failures)
- [x] Caller-initiated: caller texts something like "talk to a human" — system prompt already instructs the model to call `escalate_to_human` (system prompt §"Hard rules")
- [x] Operator-initiated from admin dashboard (Slice 15): admin can force-end via `/v1/admin/conversations/:id/force-end` — a dedicated "force-escalate" admin endpoint is a small follow-up (out of MVP scope)

**State machine extension** (CLAUDE.md §12 — `escalated` is now non-terminal)
- [x] When status='escalated', the AI advance loop **does not** pick up new caller messages — they're routed to the Slack thread via `EscalationsService.forwardCallerSmsToSlack` from `twilio-sms.controller.ts`
- [x] Operator hands back via `/bb back-to-bot` slash command OR the "Resume AI" button → `escalations` flips to `resolved`, conversation flips to `awaiting_caller`, the next caller SMS resumes advance with full history

**Schema** (migration `20260511000002_hitl_slack.sql`)
- [x] Migration: add `'slack'` to `webhook_source` enum
- [x] `slack_connections` table: `operator_id` (unique), `team_id`, `team_name`, `default_channel_id`, `encrypted_bot_token`, `scopes`, `installed_at`, `installed_by_user_id`, `status`
- [x] `escalations` table: full schema + `escalation_reason` / `escalation_status` / `escalation_opener` enums + `escalations_one_open_per_conversation` partial unique index + RLS (select-own for operator, service-role for writes)
- [x] `messages.slack_message_ts` column + sparse index

**Slack app**
- [x] Manifest YAML (`docs/slack-app-manifest.yaml`) with bot scopes, slash command, event subscriptions, interactivity URL, OAuth redirect URL
- [x] Per-operator workspace install flow (`/v1/operators/me/slack/install` → Slack OAuth → `/webhooks/slack/oauth/callback` → encrypted token written to `slack_connections`); state HMAC binds operator id so a third party can't redirect-attack the callback
- [ ] Channel picker UI on install — MVP uses the `incoming_webhook.channel` from the OAuth grant; explicit picker deferred to follow-up
- [ ] **Rebrand + re-own the Slack app "BookingBlues" → KeeprSteady (requested 2026-06-25, pre-launch).** The single BB-team Slack app (ADR 0010 single-workspace model — bot token in env, not per-operator OAuth) is still named **"BookingBlues"** and lives under the wrong/legacy Slack account. Move it to a **Slack workspace/account that KeeprSteady owns** and rebrand fully: app name, icon/logo, description, and any user-visible bot display name → **KeeprSteady**. Steps: create the app under the KeeprSteady-owned workspace from `docs/slack-app-manifest.yaml` (update the app name/branding in the manifest first), re-issue `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET` and the channel IDs (`SLACK_DEFAULT_CHANNEL_ID` #hitl, `SLACK_CONVOS_CHANNEL_ID` #convos, `SLACK_CHANNEL_LEADS_ID` #bb-leads), update prod env on Railway, re-point event/interactivity/command request URLs to `api.keeprsteady.com`, and update `docs/SLACK_SETUP.md`. Verify escalations, #convos monitoring, and #bb-leads claim buttons still work end-to-end after the move.

**Bot ↔ Slack bridge**
- [x] `escalate_to_human` now opens a Slack escalation via `EscalationsService.openEscalation`: parent message (header + context + transcript) + action buttons `[Resume AI] [Mark spam] [Close] [Show number]`, captures `thread_ts` on `escalations`
- [x] Outbound: agent thread reply → `forwardAgentReplyToSms` → `twilio.sendSms` (rate-limited 8s/conversation per §9.3) + persists as `messages.role='system'` with the Twilio sid
- [x] Inbound: caller SMS during escalation → `forwardCallerSmsToSlack` posts to the existing thread (or no-ops if Slack failed open with email fallback) + stamps `messages.slack_message_ts`
- [x] PII: caller number shows as `•••<last4>` in the parent message; full number gated behind `[Show number]` button + `/bb show-number`, both audit-logged

**Slack interactions**
- [x] Slash commands: `/bb resolve`, `/bb close-spam`, `/bb back-to-bot`, `/bb show-number` (all live); `/bb book <ISO>` is a placeholder text response (Slice 9-followup)
- [x] Action buttons (`esc_back_to_bot`, `esc_mark_spam`, `esc_close`, `esc_show_number`) wire to the same handlers
- [x] Slack webhook signature verification via `SlackSignatureGuard` (v0 HMAC, 5-min replay window, raw-body buffer); idempotency via `webhook_events` with `source='slack'`

**Caps + safety**
- [x] One open escalation per conversation enforced by partial unique index `escalations_one_open_per_conversation` (second trigger reuses the existing row)
- [x] If Slack is configured but the bot can't post (channel deleted, token revoked, 429), `openEscalation` falls back to email path — `escalations.fallback_email_sent_at` records the fallback; actual email delivery awaits Slice 10's Resend wrapper
- [x] Audit log: `conversation.escalate`, `escalation.back_to_bot`, `escalation.resolve`, `escalation.show_number` — all via `AuditLogService`
- [ ] Slack `chat.postMessage` 1 msg/sec backoff — deferred; first 429 falls into `EscalationsService` catch and logs warn (no retry loop yet)

**Doc updates** — done in the same commit
- [x] CLAUDE.md §3 architecture diagram, §4 tech-stack row, §9.3 tool description, §10 endpoint list, §11 signature/audit/encryption notes (new items 21–23), §12 state-machine note
- [x] `docs/SLACK_SETUP.md` operator setup walkthrough
- [x] `docs/slack-app-manifest.yaml` (paste into api.slack.com)

### Slice 10: Notifications + polish
- [x] Resend wrapper, transactional email templates — already shipped
  (`common/email/email.service.ts` + `summaries/email-templates`; booking
  confirmations + daily summaries use it).
- [x] **SMS templates module** (✅ 2026-06-17) — `modules/conversations/templates/sms-templates.ts`
  now holds every outbound SMS body (§9.6). Extracted 7 inline strings from
  `twilio-voice.controller` (opening), `bookings.service` (confirmation +
  fee line), `advance.service` (degraded handoff + marker),
  `tool-handlers` (payment link, 3 out-of-scope variants, escalation),
  `twilio-sms.controller` (emergency alert). Behavior-preserving; removed a
  dead `ConflictError/ValidationError` import in tool-handlers. API typecheck clean.
- [x] **1-hour reminder cron** (✅ 2026-06-17) — implemented as **HTTP cron**
  (not pg-boss — matches the existing daily-summaries pattern; ADR 0006's
  pg-boss is still unrealized). `modules/reminders/`: `POST
  /v1/internal/appointment-reminders/run` (NOTE the `/v1` global prefix — only
  `webhooks/*` is excluded in main.ts) (`@SkipThrottle`, `X-Cron-Secret`
  guard) → `AppointmentRemindersService.runDue()` sends `appointmentReminderSms`
  to confirmed, upcoming (≤60 min), not-yet-reminded appointments and stamps
  `appointments.reminder_sent_at` (idempotent). Migration
  `20260617000001_appointment_reminder_sent.sql` adds the column + a partial
  index; db-types hand-patched.
  - **Infra:** (1) migration — ✅ applied on prod (verified `reminder_sent_at`
    exists; confirms Railway pre-deploy migrate runs). (2) Railway cron —
    ✅ **WIRED + VERIFIED 2026-06-18.** A "Reminder-CRON" service (BookingBlues
    project, `alpine:latest` image, start command
    `apk add --no-cache curl && curl -fsS -X POST "$API_URL/v1/internal/appointment-reminders/run" -H "X-Cron-Secret: $CRON_SHARED_SECRET"`,
    schedule `*/5 * * * *`, vars `API_URL` + `CRON_SHARED_SECRET`) fires every
    5 min and returns `{"window_minutes":60,"attempted":0,...}` (200). Note the
    `/v1` prefix on the path (only `webhooks/*` is excluded from the global
    prefix) — earlier 404s were a missing `/v1`, the 403 was a stale pre-secret
    run. Cron-service gotcha: it needs a **Source image connected + an actual
    Deploy** — a saved schedule alone shows "No deployments found" and never runs.
  - **Still TODO:** the **daily-summaries** cron was never wired either (coded
    but dormant). Same recipe, URL `/v1/internal/daily-summaries/run`, daily
    schedule (e.g. `0 13 * * *`). Only matters once there are live operators.
- [ ] Smoke checklist `apps/api/test/SMOKE.md`

### Slice 11: Observability — Sentry

**Shipped 2026-06-17** (`@sentry/node` + `@sentry/nextjs`, both `^10.58`):
- ✅ **api** — `apps/api/src/instrument.ts` (imported first in `main.ts`) inits
  `@sentry/node`; `ProblemDetailsFilter` captures 5xx/unknown via
  `Sentry.captureException` with non-PII tags (code, request_id). No-op without
  `SENTRY_DSN_API`. Typecheck clean.
- ✅ **web** — `instrumentation.ts` (server/edge configs) + `instrumentation-client.ts`
  + `withSentryConfig` wrap in `next.config.mjs`. Server/edge read
  `SENTRY_DSN_WEB`; client reads `NEXT_PUBLIC_SENTRY_DSN_WEB`. **Verified a full
  `next build` (Turbopack) succeeds** with the wrap. No-op without DSNs.
- ✅ **PII scrubbing** — shared recursive `beforeSend`/`beforeSendTransaction`
  scrubber (`apps/api/src/instrument.ts`, `apps/web/lib/sentry-scrub.ts`)
  redacts keys matching §11.5 (phone/email/Twilio From-To-Body/auth/cookie/
  signature/token/secret). `sendDefaultPii: false`.
- ✅ Env documented — `.env.example` + CLAUDE.md §7 (incl. new
  `NEXT_PUBLIC_SENTRY_DSN_WEB` + optional source-map upload vars).

**Activation (user):** create Sentry projects and set `SENTRY_DSN_API`,
`SENTRY_DSN_WEB`, `NEXT_PUBLIC_SENTRY_DSN_WEB` on Railway. Optional source-map
upload: `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN`. Until then Sentry
is inert (no events sent).

**Deferred:** release tagging beyond `RAILWAY_GIT_COMMIT_SHA`, end-to-end
redaction integration test, alert routing. Original checklist below.

- [x] Sentry SDK init in `apps/api` with PII scrubbing config matching §11.5 redact paths
- [x] Sentry SDK init in `apps/web`
- [ ] Source maps upload from CI (api + web)
- [ ] Release tagging via git SHA; environment tag (`development`/`staging`/`production`)
- [ ] User context: attach `operator_id` (never raw email/phone) to error events
- [ ] Tracing/performance: capture API request transactions; sample rate per env
- [ ] Alert routing destination (Slack channel? Email? PagerDuty?) — TBD
- [ ] Verify redactions: integration test that confirms a known PII payload is scrubbed end-to-end

### Slice 12: CI gates + security scanning
Triggered on every PR and push to `main`. Blocks merge on failures.

**First cut shipped 2026-06-17** (`.github/workflows/ci.yml`, `.github/dependabot.yml`,
`.gitleaks.toml`, `docs/CI_AND_BRANCH_PROTECTION.md`):
- ✅ `build` job — install (corepack pnpm, no action-setup) → **typecheck** →
  **build** (api + web; web gets placeholder `NEXT_PUBLIC_*`). Both blocking.
- ⚠️ lint + format:check run **report-only** (eslint declared but gate not yet
  proven repo-clean) — flip to blocking via task #8.
- ✅ `audit` job — blocks on **critical** (currently 0; `next` is 16.2.5 so the
  old criticals are gone), reports **high** (11 transitive, mostly
  `form-data <4.0.6`) non-blocking until remediated (task #8).
- ✅ `gitleaks` job — bare binary (not the action — Dependabot-token footgun),
  full history, `.gitleaks.toml` allowlists `.env.example`.
- ✅ Dependabot — npm (workspace root) + github-actions, weekly, grouped
  minor/patch.
- Branch protection documented (manual UI step) in `docs/CI_AND_BRANCH_PROTECTION.md`.
- **Deferred** (task #8 + Phases 2/5): Supabase-backed test + RLS/cross-tenant
  jobs (need ephemeral test project, never prod), CodeQL, Trivy, license check.
- [ ] GitHub Actions workflow: install, typecheck, lint, test, build (matrix per app)
- [ ] **Secret scanning** — `gitleaks` pre-commit hook + CI workflow (per §11.8)
- [ ] **Dependency vulnerability scanning** — `pnpm audit --prod` gate; block merge on high+ severity (per §11.19)
- [ ] **Dependabot** — npm ecosystem + GitHub Actions ecosystem; weekly cadence
- [ ] **Static analysis** — CodeQL (or Semgrep) workflow
- [ ] **Lockfile + container scan** — Trivy on the API Docker image
- [ ] **License compliance** — `license-checker` allowlist
- [ ] **Branch protection** — require passing checks; require signed commits; no force-push to `main`
- [ ] **RLS regression suite** runs in CI against an ephemeral Supabase test project (per §11.18)
- [ ] **Cross-tenant isolation suite** runs in CI on every PR (per §11.11)

### Slice 13: Railway staging deployment
- [ ] Railway services (api, web, worker)
- [ ] Pre-deploy migration command
- [ ] Staging Supabase + Stripe test mode + Twilio subaccount
- [ ] Domain + HSTS preload (§11.20)
- [ ] End-to-end smoke run on staging before any production traffic

### Slice 13.5: Custom domain cutover (pre-launch)
Currently we run on Railway-generated URLs (`bookingbluesapi-production.up.railway.app` /
`bookingbluesweb-production.up.railway.app`). Every provider config + env var
references them. Need a coordinated swap to a real owned domain
(e.g. `bookingblues.com` for web, `api.bookingblues.com` for API, or whatever
the chosen domain ends up being).

**DNS + TLS**
- [ ] Register / configure DNS records (A / CNAME) pointing to Railway services
- [ ] Configure custom domains in Railway dashboard for both api + web services — Railway provisions ACME certs automatically
- [ ] Verify HSTS preload still active on the new domains; submit to https://hstspreload.org/ once the production domain is stable
- [ ] Email sending: Resend domain verification (DKIM, SPF, DMARC) on the same root domain or a subdomain (e.g. `mail.bookingblues.com`)

**Provider config swap** (every URL referenced explicitly somewhere)
- [ ] **Supabase** (Auth → URL Configuration): Site URL + redirect URL allowlist updated to the new web domain. Old Railway URL removed once the cutover is verified to avoid open-redirect risk.
- [ ] **Stripe**:
  - Platform webhook endpoint URL (Developers → Webhooks → existing endpoint → Update) → new `https://<api domain>/webhooks/stripe`
  - Connect webhook endpoint URL → new `https://<api domain>/webhooks/stripe/connect`
  - Verify webhook signing secrets DON'T change on URL update (they shouldn't — but smoke a test event after each)
  - Checkout success_url / cancel_url already env-driven via `APP_URL`; updates with env var change
- [ ] **Google OAuth**:
  - Authorized redirect URIs in the OAuth Client → add the new `https://<api domain>/webhooks/google/oauth/callback`. Keep the old one until cutover, remove after.
  - OAuth Consent Screen → app domain + privacy policy URL + terms URL → update to the new domain
  - When ready to leave Testing mode and submit for verification, the production domain must be the one on file
- [ ] **Twilio**:
  - Existing provisioned numbers' voice + SMS webhook URLs (Console → Phone Numbers → each number) → swap from old Railway URL to new API domain. Or: write a one-shot script that iterates `incomingPhoneNumbers.list()` and updates each `voiceUrl` + `smsUrl`
  - Future provisions auto-pick up the new URL because the code uses `${env.API_URL}` — just update the env var
- [ ] **Sentry**:
  - Project → Settings → URL — update for nicer DSN URLs (cosmetic; existing DSNs keep working)
  - Add the new domain as the environment's "URL" so error events link to the right page
- [ ] **Resend** (when Slice 10 lands):
  - Sending domain swap (DKIM/SPF/DMARC); old domain decommission

**Env vars to update simultaneously** (every place we have hard-coded the Railway URL or its variants)
- [ ] `APP_URL` (api service)
- [ ] `API_URL` (api service)
- [ ] `NEXT_PUBLIC_APP_URL` (web service)
- [ ] `NEXT_PUBLIC_API_URL` (web service)
- [ ] `GOOGLE_OAUTH_REDIRECT_URI` (api service)
- [ ] `OUTBOUND_SMS_ALLOWLIST` — unchanged; phone numbers, not URLs
- [ ] CORS allowlist in `apps/api/src/main.ts` already pulls from `env.APP_URL` — auto-updates
- [ ] `docs/DEPLOY_RAILWAY.md` — replace example URLs throughout

**Validation gates**
- [ ] Sign up on new domain → email confirm link points to new domain (Supabase Site URL working)
- [ ] Onboarding step 1 trial → Stripe Checkout → return URL is new domain (Stripe webhook reaches new API)
- [ ] Onboarding step 4 Google connect → consent screen shows new domain → callback hits new API
- [ ] Onboarding step 3 Twilio number provisioning → number's voice/sms webhook URLs in Twilio Console show new API domain
- [ ] Real test call to the Twilio number → bot greeting + opening SMS works
- [ ] Run `curl -sI` against the new API + web domain — verify all the helmet headers + HSTS preload, no `X-Powered-By`

### Slice 15: Internal admin dashboard (REQUIRED pre-revenue) — ✅ **shipped 2026-05-11**
Operating a customer-facing SaaS without an internal control plane is untenable
— support tickets, dunning, fraud, refunds, abuse all need a "see + act" surface.
This is BookingBlues *staff* only, not Operator-facing. Distinct from CLAUDE.md §16
"Multi-user/teams per Operator" (which is post-MVP and rules out *Operator* teams).

**Decision recorded** in `docs/adr/0009-admin-role-via-app-metadata.md`: admin
role lives in `auth.users.app_metadata.role = 'admin'` (server-only-writable —
operators can't self-promote). Derived at JWT-verify time and surfaced on
`AuthenticatedUser.isAdmin`.

**Schema additions** (migration `20260511000001_admin_role_helper.sql`)
- [x] Picked `auth.users.app_metadata.role = 'admin'` (ADR 0009). No new table.
- [x] `audit_log` already existed (CLAUDE.md §8); shared `AuditLogService` writes from every admin action with IP + user-agent captured from the request.

**Auth + authorization**
- [x] `AdminGuard` (NestJS) composes `AuthGuard` + an `isAdmin` check. Fail-closed (returns false if the inner auth fails without an exception).
- [x] Admin web routes (`/admin/*`) gated by `apps/web/middleware.ts` reading `app_metadata.role`; non-admins redirected to `/dashboard`. Layout double-checks server-side.
- [x] Stricter throttle: 30/min reads, 10/min writes (vs. operator default 60/min).

**Read-only surfaces**
- [x] `GET /v1/admin/operators?cursor&q&status&has_twilio&has_calendar` — cursor pagination via base64-encoded `(created_at,id)` opaque token
- [x] `GET /v1/admin/operators/:id` — dossier: profile, subscription state, totals, Stripe/Twilio deep-links rendered in the dossier page
- [x] `GET /v1/admin/operators/:id/conversations` + `/v1/admin/conversations/:id/messages`
- [x] `GET /v1/admin/operators/:id/appointments`
- [x] `GET /v1/admin/operators/:id/payments`
- [x] `GET /v1/admin/operators/:id/audit-log`
- [x] `GET /v1/admin/metrics` — global counters: operators by status, conversations active now, escalations open, fee revenue MTD. MRR/ARR/trial→paid % and OpenAI cost MTD deferred (need a Stripe sync job + token-usage logging in Slice 7-followup; placeholder of 0 for now)

**Write actions (each writes `audit_log`)**
- [x] `POST /v1/admin/operators/:id/deactivate` — cancels Stripe subscription (immediate or end-of-period), closes in-flight conversations
- [x] `POST /v1/admin/operators/:id/release-twilio-number` — `incomingPhoneNumbers(sid).remove()`, marks `twilio_numbers.released`, clears operator fields
- [x] `POST /v1/admin/operators/:id/refund-payment/:paymentId` — wraps `PaymentsService.refundBookingFee` (which already handles `refund_application_fee: true` per §9.5)
- [x] `POST /v1/admin/operators/:id/cancel-subscription` — Stripe cancel, immediate OR end-of-period
- [x] `POST /v1/admin/conversations/:id/force-end` — set status `completed`, configurable outcome
- [x] `POST /v1/admin/operators/:id/impersonate` — Supabase magic-link generated via admin SDK; opens in a new private tab; reason required + audit-logged
- [x] `POST /v1/admin/admins` / `DELETE /v1/admin/admins/:userId` — admin promotion/demotion (an admin can't demote themselves)

**Web UI** (`apps/web/app/(admin)/...`)
- [x] `/admin` dashboard with global metric cards (warn-tone for past-due, escalations)
- [x] `/admin/operators` searchable table with status filter + cursor pagination
- [x] `/admin/operators/[id]` dossier — stats grid, action bar, tabs (conversations / appointments / payments / audit log), provider deep-links collapsible
- [x] Risky actions use the branded `ConfirmModal` with type-business-name for `Deactivate`; required free-text reason for every destructive action
- [x] Distinct admin theme: red banner ("BookingBlues Admin · Internal use only · Every action is logged"), red app-name + nav, separate route group

**Operational**
- [x] First admin: `admin_promote(text)` SQL function (SECURITY DEFINER, search_path pinned). Operator runs `select admin_promote('me@bb.com');` once from Supabase SQL editor; subsequent admins use the API
- [ ] **Global audit-log report (NET-NEW, requested 2026-06-25)** — today audit logs are only viewable per-operator (`GET /v1/admin/operators/:id/audit-log` + the dossier tab). Add an **exhaustive `/admin` audit-log view** across ALL actors/operators: a new `GET /v1/admin/audit-log` (cursor-paginated, newest-first) with filters (action type, actor user, operator, resource type, date range) and a searchable `/admin/audit-log` page. Surfaces every `audit_log` row — admin writes (deactivate, refund, cancel, impersonate, force-end, promote/demote, **sales.release_leads**), escalation actions, calendar/Twilio events. Read-only; respects the same `AdminGuard`. Consider CSV export for compliance.
- [ ] Audit log retention policy — deferred to Slice 14 (production go-live)
- [x] Pre-launch hardening — AdminGuard tested for 403 on non-admin, 401 on bad token, true on isAdmin. JwtVerifierService tested for role derivation including the `user_metadata.role='admin'` injection attempt (correctly rejected — only `app_metadata.role` is trusted)

### Slice 14: EC2 production deployment (go-live)
Migration target when we're ready to leave Railway and serve real traffic.
- [ ] Architecture decision (record in `docs/adr/`): instance sizing, AZ/region, AMI strategy
- [ ] Infrastructure as Code — Terraform (or CDK / Pulumi — decide)
- [ ] VPC + public/private subnets, security groups, IAM roles, Secrets Manager
- [ ] Application Load Balancer + TLS via ACM; HSTS preload (§11.20)
- [ ] Auto Scaling Group for `api`; separate ASG for queue workers
- [ ] Database path: continue Supabase via VPC peering OR migrate to RDS — decide
- [ ] CloudWatch logs + metrics (or ship structured logs to Sentry/Datadog)
- [ ] Deployment pipeline: CodeDeploy or Actions-driven blue/green; immutable releases
- [ ] Backup/restore procedure tested end-to-end
- [ ] Cutover plan from Railway → EC2: DNS, data, webhook URL updates for Twilio/Stripe/Google, rollback path
- [ ] Runbooks: deploys, rollbacks, incident response, key rotation
- [ ] Update CLAUDE.md §4 and §14 to reflect EC2 as production target

---

## 🪠 Plumbing-vertical pivot (2026-05-13 — captured from user roadmap)

> ⚠️ **REVERSED — product is multi-trade Home Services (directive 2026-06-17).**
> The plumbing-only narrowing below (Slice 16) was undone by the multi-trade
> reversal (shipped 2026-05-29): all 5 trades — plumbing, HVAC, electrical,
> roofing, garage door — are live. KeeprSteady is **Home Services, not
> plumber-only**, at launch. The Slices 17–22 roadmap below is still written in
> legacy plumber-only language; when building any of them, **generalize copy, AI
> prompts, job-type lists, and examples across all trades** — do not ship
> plumber-only wording. (The category-driven system prompt + `SERVICES_BY_CATEGORY`
> are already multi-trade; match that breadth.) See memory
> `project_home_services_not_plumber_only`.

Strategic narrowing (historical): every signup from a non-plumbing trade is a wasted lead until
the product is dialed in. **Hide all non-plumbing categories, double down on the
plumber wedge, then expand.** No code is being deleted — non-plumbing trades come
back behind a feature flag once plumbing converts well.

The work splits cleanly into six themes. Each theme is roughly one slice of
build, but inside a theme items can ship independently.

### Slice 16 — Plumbing-only collapse (foundation) — ✅ **shipped 2026-05-14, verified in prod 2026-05-15**

The unblocker. Shipped all three sub-items in the plumbing-MVP cut. Deployed
and verified in prod on 2026-05-15. Required a Turbopack-bug workaround late
in the day — see below.

- [x] **(1) Hide non-plumbing categories** — `ENABLED_CATEGORIES` env (api)
      + `NEXT_PUBLIC_ENABLED_CATEGORIES` (web) feature-flag the 4 non-plumber
      categories. Server-side gate in `OperatorsService.update` enforces
      rejection so a stale frontend can't bypass. DB seeds untouched — flip
      env to re-enable.
      
      **Turbopack workaround (2026-05-15)**: Next.js 16's Turbopack
      production build does NOT inline custom `NEXT_PUBLIC_*` env vars at
      call sites (confirmed empirically — known-good vars like
      `NEXT_PUBLIC_SUPABASE_URL` inline because they're referenced in
      `middleware.ts`; new vars only used through the `publicEnv` zod
      schema in `lib/env.ts` do not). The `env: { ... }` block in
      `next.config.mjs` also did not force inlining. Caused a hydration
      mismatch (React error #418): server had the real env from Node, the
      client bundle had `undefined`, trees diverged, React discarded the
      SSR tree and re-rendered with the fallback (all 5 categories).
      
      **Fix**: read the env in the `/onboarding` Server Component, pass
      values to the `<Wizard>` client component as props. Server-side
      reads always work; props serialize into the rendered HTML so the
      client receives identical values during hydration. See
      `apps/web/app/(dashboard)/onboarding/page.tsx`. `export const
      dynamic = 'force-dynamic'` keeps the route from being statically
      pre-rendered (which would freeze env at build time).
- [x] **(4) Plumbing-specific landing + FAQ + pricing teaser** — new hero
      ("Plumbers: never miss another emergency call."), plumber-tuned
      feature cards (emergency alerts, plumbing-tuned vetting, calendar +
      deposit), plumber testimonial placeholder, SMS mockup rewritten to a
      burst-pipe conversation. FAQ rewritten with 8 plumber-objection
      entries ("what if it tries to book a job I can't take?", "what
      about commercial calls?", "does it work with Jobber?").
- [x] **(15) STOP opt-out compliance copy** — opening SMS now ends with
      `Reply STOP to opt out. Msg & data rates may apply.` (Twilio
      enforces STOP/UNSTOP automatically — the disclosure is the only
      code change needed for 10DLC approval.) DB-level opt-out tracking
      deferred — not blocking 10DLC review.

### KeeprSteady launch prep + billing migration — ✅ **shipped 2026-05-27, UNTESTED IN PROD**

Two large bundles landed in one session. Both typecheck clean on api + web.
Nothing has been deployed or smoke-tested yet — user is testing 2026-05-28.

**Source of truth for the change:** the spec docs at
`/Users/vikas/Downloads/files(1)/KeeprSteady_Edit_Specs.docx` (31 site edit
items) and `/Users/vikas/Downloads/files(1)/KeeprSteady_Legal_Docs.docx`
(Privacy Policy + Terms of Service).

#### Bundle 1 — Site rebrand + legal + home-services reframe

- [x] **ED-01 brand rename** — every "BookingBlues" string across
      `apps/web/**` swapped to "KeeprSteady" (23 files: layouts, dashboard
      welcome, admin, Nav, SettingsPanel, CarrierForwarding, SalesCalculator,
      OperatorActions/Tabs, Wizard, api.ts comment). Zero remaining
      case-insensitive matches in the web tree.
- [x] **Shared brand constants** — `apps/web/lib/brand.ts` is the new
      single source of truth for name / sales email / Cal.com URL /
      LinkedIn URL / plan data (`PLANS` array drives both the public
      pricing page and the wizard plan picker).
- [x] **ED-19 LegalFooter component** — `apps/web/components/LegalFooter.tsx`
      renders the AI disclaimer + TCPA STOP notice + Privacy/Terms/Contact
      links + LinkedIn icon. Wired into both `(marketing)/layout.tsx` and
      `(auth)/layout.tsx` so the disclaimer appears on every public page.
- [x] **ED-02, ED-06, ED-08, ED-14, ED-16, ED-18, ED-28 homepage rebuild** —
      home-services reframe (still leads with plumbers but explicitly names
      HVAC/roofing/electrical/locksmith), placeholder testimonial removed,
      "See it in action" section with dashboard + job-brief CSS mockups,
      competitive differentiation table (live answering / basic missed-call
      text / KeeprSteady), 10% alignment callout, trial copy standardised to
      "7-day free trial — no charge until day 8 · Cancel in 2 clicks from
      Settings", "Book a 15-min demo" secondary CTA next to every signup CTA.
- [x] **ED-03, ED-04, ED-05, ED-23 pricing rebuild** —
      `apps/web/app/(marketing)/pricing/page.tsx` now renders 3 tiers from
      `PLANS` via `PricingTiers.tsx` (client component with monthly/annual
      toggle). Crew has a "Most popular" badge. Inline 4-question FAQ
      accordion ("Can I cancel anytime?", "What happens after my free
      trial?", "What counts as a conversation?", "Is deposit collection
      required?"). HITL trust paragraph + 10% alignment callout below the
      tiers. Per-tier deposit fee row (10/15/20%) with tooltip explaining
      pass-through to customer.
- [x] **ED-11 unique meta titles + descriptions per page** — every
      marketing page exports its own `metadata`, including
      canonical URLs. Auth pages get `robots: { index: false }`.
- [x] **ED-24 OG / Twitter card meta** — set on root `metadata` in
      `app/layout.tsx` with `metadataBase` + `/og-image.png` reference.
      **Asset not yet in `/public`** — Next 404s gracefully until file lands.
- [x] **ED-25 favicon hookup** — `icons: { icon, apple }` in root metadata
      reference `/favicon.ico` + `/apple-touch-icon.png`. Same asset gap.
- [x] **ED-07 contact page** — `apps/web/app/(marketing)/contact/page.tsx`
      embeds the Cal.com booking widget as an iframe (`?embed=true`) +
      shows `sales@keeprsteady.com` for email fallback. Linked from header,
      footer, and pricing page CTA.
- [x] **ED-13 Privacy + Terms pages** — full pages at
      `apps/web/app/(marketing)/privacy/page.tsx` and `/terms/page.tsx`,
      content lifted verbatim from `KeeprSteady_Legal_Docs.docx` with brand
      constants interpolated. Both use a shared `Section` helper with
      Tailwind arbitrary variants for typography (`[&_h3]:...`,
      `[&_ul]:list-disc`). Florida governing law, AAA arbitration in Polk
      County, FL, 3-month liability cap.
- [x] **ED-15 LinkedIn social link** — placeholder URL
      `https://www.linkedin.com/company/keeprsteady` in `lib/brand.ts`.
      Footer icon links to it. **Flip the constant when the page exists.**
- [x] **ED-17, ED-29 FAQ full rewrite** — 15 entries covering: multi-trade,
      AI accuracy (the differentiator question), out-of-scope handoff,
      setup time, missed-call forwarding, emergencies, Jobber/HCP,
      Solo/Crew/Fleet pricing detail, overages, deposit requirements per
      tier, what-AI-does-when-it-can't-book, trial-end behaviour, data
      residency, cancellation.
- [x] **ED-09 demo CTA everywhere** — every primary CTA on the home and
      pricing pages now has a "Book a 15-min demo" secondary CTA pointing
      at the Cal.com URL. Also surfaced in the marketing header (desktop).
- [x] **ED-10 signup loading skeleton** — replaced the bare "Loading…"
      Suspense fallback on `/signup` and `/login` with a CSS skeleton that
      matches the field/button layout. Reads as "form initialising"
      instead of "site broken."
- [x] **ED-12, ED-22 login brand fix** — login subhead reads "Sign in to
      your KeeprSteady account." Auth-layout left column re-pitched as
      home-services with multi-trade bullet ("Trade-specific vetting for
      plumbers, HVAC, roofers, and electricians").
- [x] **ED-20 signup left column reframe** — handled via the shared auth
      layout update above.
- [x] **ED-21 signup ToS consent checkbox** — `AuthForm.tsx` (signup mode)
      now has a required checkbox `I agree to the Terms of Service and
      Privacy Policy.` Submit is disabled until checked, with a JS backstop
      in `handleSubmit` for AT/form-fill bypasses. Post-trial billing
      authorization disclosure rendered below the submit button.

#### Bundle 2 — Billing migration: Starter/Pro → Solo/Crew/Fleet × monthly/annual

This was the previously-flagged follow-up from the rebrand. Without it the
marketing page advertised tiers that the API didn't accept.

- [x] **Migration `20260515000001_operator_plan.sql`** — adds
      `operators.plan` (`solo|crew|fleet`), `operators.plan_cadence`
      (`monthly|annual`), `operators.stripe_price_id` (text). All nullable
      with CHECK constraints. Index on `plan` for admin "how many on each
      tier" queries. **Not yet run** — user runs `pnpm db:migrate` on
      2026-05-28.
- [x] **db-types patched by hand** — `packages/db-types/src/database.types.ts`
      gets the three new operator columns inserted into Row/Insert/Update.
      Mirrors what `pnpm gen:db` would emit after the migration. Re-run
      `pnpm gen:db` to confirm parity once Supabase local is up.
- [x] **API env** — `STRIPE_PRICE_STARTER`/`_PRO` removed from
      `apps/api/src/config/env.ts`. Six new vars added:
      `STRIPE_PRICE_{SOLO,CREW,FLEET}_{MONTHLY,ANNUAL}`. All six added to
      `strictRequiredInProd`. `.env.example` updated with setup notes.
- [x] **Billing DTO** — `apps/api/src/modules/billing/billing.dto.ts` now
      exports `PlanSchema = z.enum(['solo','crew','fleet'])` +
      `CadenceSchema = z.enum(['monthly','annual'])` (defaults to monthly).
      `CreateCheckoutSession` accepts `{plan, cadence, business_name?}`.
- [x] **Billing service** — `priceForPlan(plan, cadence)` constructs the
      env key (`STRIPE_PRICE_${PLAN}_${CADENCE}`) and pulls the typed value
      from env. Subscription metadata at checkout now carries
      `{operator_id, plan, cadence, stripe_price_id}` on both
      `subscription_data.metadata` and the top-level session metadata
      (Stripe surfaces only one of these depending on event type).
- [x] **Webhook persistence** — `stripe-event-handlers.ts`
      `onSubscriptionUpserted` extracts `plan` + `cadence` from
      `subscription.metadata` (narrowed via local helpers — anything we
      don't recognise stays null so we never persist garbage). Reads
      `stripe_price_id` from `subscription.items[0].price.id` so Stripe
      remains the source of truth even if a user mutates metadata via the
      Customer Portal during a plan switch.
- [x] **Wizard 3-tier plan picker** — Subscribe step renders all three
      `PLANS` cards with a monthly/annual cadence toggle and "Most
      popular" badge on Crew. `startBilling(plan, cadence)` POSTs
      `{plan, cadence}` to `/v1/billing/checkout-session`. Multi-button
      busy guard prevents double checkout across all six plan×cadence
      buttons.
- [x] **Tests** — `stripe-webhook.spec.ts` env presets swapped to the six
      new vars. `prompts.spec.ts` operator fixture filled in the three new
      columns (plan/plan_cadence/stripe_price_id) to satisfy the stricter
      Row type. Full suite still wired against real Supabase — not run in
      this session.
- [x] **Typecheck** — `pnpm --filter api typecheck` and
      `pnpm --filter web typecheck` both pass clean.

#### Intentionally left as-is

- **SalesCalculator** (`apps/web/components/admin/SalesCalculator.tsx`)
  still uses `TierKey = 'starter' | 'pro' | 'enterprise'` with internal
  commission tier names ("Launch"/"Command"/"Fleet") and different
  pricing ($997/$1,897/$3,497). These are sales-rep commission tiers,
  not customer billing plans — orthogonal. Flag for separate cleanup if
  desired.
- **No env.example for the marketing site brand vars** — keeping
  `lib/brand.ts` as the constants source keeps the build deterministic
  and avoids another NEXT_PUBLIC_* inlining variable.
- ~~**No screenshots/OG image asset**~~ — **resolved 2026-05-28.** Brand
  assets generated from user-supplied logo (`~/Downloads/favicon.jpg` K
  mark on black + `~/Downloads/canvas.png` transparent wordmark) via
  Pillow into `apps/web/public/`: `favicon.ico` (16/32/48), `icon.png`
  (32), `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180),
  `og-image.png` (1200×630, wordmark on black). `app/layout.tsx` `icons`
  metadata references the full PNG set. Homepage product mockups remain
  CSS-rendered (not real screenshots) — that's fine.

### Post-launch-prep hardening + multi-trade reversal (2026-05-28 → 05-29) — ✅ **committed, UNTESTED in prod**

Continuation of the KeeprSteady launch prep. All committed (HEAD `0aac035`,
8 commits: terms → social links → build fix → logo → home-services → brand
colors). Typechecks + `pnpm --filter web build` pass. **Not yet smoke-tested
on the live system** — that's Monday's job (see `project_resume_after_restart.md`).

**Brand assets + logo**
- Generated from user art (`~/Downloads/favicon.jpg` = K mark on black,
  `~/Downloads/canvas.png` = transparent wordmark) via Pillow into
  `apps/web/public/`: `favicon.ico`, `icon.png`, `icon-192/512`,
  `apple-touch-icon`, `og-image` (wordmark on black), `logo-mark.png`
  (rounded K chip).
- `components/Logo.tsx` — 40px header mark, no wordmark text. Used in
  marketing, auth, AND dashboard (`Nav.tsx`) headers so all three match.

**Terms-of-Service acceptance tracking** (migration
`20260528000001_operator_terms_acceptance.sql` — `operators.terms_accepted_at`
+ `terms_version`, nullable)
- Captured at signup into `auth.users.user_metadata` (`AuthForm`); mirrored
  onto operators server-side at row creation (operators bootstrap +
  `billing.ensureOperator`).
- `TERMS = { version: '2026-05-26', effectiveDate }` in `lib/brand.ts`;
  Terms/Privacy pages read `effectiveDate`. Bump `version` to force a
  site-wide re-accept.
- Middleware re-accept gate: authed + `/dashboard|/onboarding|/settings` +
  `user_metadata.terms_version !== TERMS.version` → redirect `/accept-terms`
  (admin exempt; `/accept-terms` not a protected prefix so no loop).
  `/accept-terms` updates metadata + `POST /v1/operators/me/accept-terms`
  (server-trusted mirror). db-types hand-patched.
- **Build gotcha (fixed):** `/accept-terms` used `useSearchParams()` without a
  `<Suspense>` boundary → Railway prod build failed prerendering. Wrapped it
  (same pattern as signup/login). **Lesson:** run `pnpm --filter web build`,
  not just `tsc`, before deploy — tsc misses prerender errors.

**Multi-trade reversal across the product** (undoing the Slice 16 plumbing-only cut)
- API user-facing brand strings BookingBlues→KeeprSteady (the earlier rebrand
  only touched `apps/web`): summary emails, daily-summary subject, emergency
  alert SMS, ICS `PRODID`, Slack thread-match message.
- `emergency-detection.ts`: added cross-trade keywords (electrical: sparks,
  burning smell, exposed wire, electrical fire; roofing: roof/ceiling leak,
  water coming through, storm damage; HVAC: no heat, no ac).
- `emergency-classifier.service.ts`: was hardcoded "to a plumber" → now
  trade-aware `classify(body, category)` with all-trades examples + "home
  services" fallback. Twilio webhook passes `operatorRow.category`.
- Stale "Plumbing-only MVP" comments in both `env.ts` files updated.
- Already trade-agnostic (no change): category-driven AI system prompt,
  `vanity-slugs`, `tool-handlers` SERVICES_BY_CATEGORY, wizard trade list.
- **Action still required (infra, not code):** remove
  `NEXT_PUBLIC_ENABLED_CATEGORIES` (web service) + `ENABLED_CATEGORIES` (api
  service) on Railway — both currently `plumbing` — then redeploy. Unset =
  all 5 trades. Existing plumbing operators are not migrated.

**Brand accent → #6B3FA0** (KeeprSteady purple; was `#0b5cd6` blue)
- `tailwind.config` `accent` token is now nested: `DEFAULT #6B3FA0`,
  `dark #55307F` (hover), `light #B79CE6` (dark-mode text). All `*-accent`
  classes recolor automatically.
- Swapped accent-paired blues (`hover:bg-blue-700`→`hover:bg-accent-dark`,
  `dark:text-blue-400`→`dark:text-accent-light` incl. `globals.css` link,
  hero badge tint, ProofStat numbers, nav `hover:text-accent`).
- Kept semantic status blues (appointment "confirmed" badge, Stripe-connect
  info banner, admin lead badges, SalesCalculator palette).

### Slice 17 — Smarter scheduling & emergency triage

The #1 ask from plumber interviews. A burst pipe at 11pm is a different flow
than "leaky faucet, can wait."

- [ ] **(2) Drive-time aware booking + 90-min default slots** — every
      appointment is 90 min. Compute drive time between consecutive jobs on
      the operator's calendar (Google Distance Matrix API) and pad slot
      offerings accordingly so back-to-back jobs don't overrun.
- [ ] **(2b) Multi-truck capacity-based booking (requested 2026-06-26)** — today
      availability is **single-resource**: `check_availability` uses the operator's
      Google Calendar free/busy and `book_appointment` takes an advisory lock on
      `(operator_id, slot_start)` so **one** appointment can exist per slot. Many
      operators run **multiple trucks/crews** and can serve **N concurrent jobs**.
      Change availability + booking to be **capacity-aware**: a slot is bookable
      while the number of overlapping confirmed appointments is **< truck_count**.
      **Operator-configurable fields:** `truck_count` (concurrency, default 1) and a
      **service window / appointment duration** (default **120 min** per the user;
      note this conflicts with the current 60-min `book_appointment` and the "90-min"
      copy in (2)/(3) — reconcile to one source). Design considerations: (a) replace
      the single-slot advisory lock with a **count-overlaps-then-allow-if-<capacity**
      check (still race-safe via a transaction / `SELECT … FOR UPDATE` or advisory
      lock on `operator_id`); (b) Google Calendar single-primary free/busy can't model
      capacity — decide between a **capacity counter from the `appointments` table**
      (count overlaps in the window) vs **per-truck calendars**; (c) the AI prompt /
      `check_availability` must surface remaining capacity per window, not just
      free/busy; (d) drive-time padding (2) interacts with per-truck scheduling.
- [ ] **(3) Emergency vs urgent vs scheduled routing** — AI classifies each
      call into one of three buckets:
      - *Emergency*: next available 90-min slot today, override standard
        business hours, push a mobile notification to the plumber.
      - *Urgent*: next available slot within 48 hours.
      - *Scheduled*: normal calendar logic.
- [x] **(17) Emergency detection — hybrid keyword + AI** — ✅ **shipped
      2026-05-14**. Keyword pre-filter (`emergency-detection.ts`) catches
      obvious phrases in 0 ms / $0. When the keyword path misses, an AI
      classifier (`emergency-classifier.service.ts`, `gpt-4.1-mini`) runs
      fire-and-forget against the inbound SMS — strict prompt distinguishes
      "leaky faucet" (no) from "basement filling up" (yes). On match, an
      alert SMS goes to the plumber's `personal_phone_e164` with the
      caller's number + AI-extracted reason. AI advance loop continues in
      parallel — no 60s timeout / fallback. Cost ~$0.0005 per
      AI-classified non-emergency call; $0 when the keyword path
      triggers.
- [ ] **(17b) Unify the two emergency paths — emergency does BOTH (requested 2026-06-26)** —
      emergency *detection* (alerts the OPERATOR's phone, `twilio-sms.controller`)
      and the AI's *escalation* (`escalate_to_human`, prompt-driven → BB #hitl) are
      decoupled today and use different definitions. **Decision made: on any
      detected emergency, do BOTH** — alert the operator's phone AND open a #hitl
      escalation (so a human can engage). Reconcile to one trade-aware definition
      feeding both. Implementation note: the classifier is fire-and-forget/async and
      the advance loop runs in parallel — opening the escalation needs to race-safely
      suppress/await the AI advance (keyword path is sync, AI-classifier path is
      async). Also tighten the `escalate_to_human` reason enum so emergencies log
      `emergency`, not `caller_requested`.
- [ ] **(17c) Collect name + address + validate service area BEFORE any handoff
      (requested 2026-06-26)** — today the AI can `escalate_to_human` (e.g. on an
      emergency) without capturing the caller's name/address or running the
      service-area ZIP check, so the human inherits a thin handoff. Change the
      prompt + `escalate_to_human` to gather name + address and validate the
      address is in the operator's service area first. Provide a FAST variant for
      true emergencies (name + address only) so it doesn't delay the human
      callback.
- [ ] **(17d) Slack button to send the payment request when a HUMAN books (requested 2026-06-26)** —
      HITL + payments gap: the booking fee link only fires from the AI's
      `book_appointment`. When a human books via the Slack **Booking Action**
      (`esc_book`) — common after an emergency handoff — **no fee is collected**.
      Add a Slack **"Send payment request"** button (and/or auto-send on `esc_book`)
      that texts the caller the booking-fee Checkout link (reuse
      `createBookingFeeCheckout`, same 4-gate eligibility) so they can pay. Must
      include the emergency visit fee (17e) when the conversation is an emergency.
- [ ] **(17e) Emergency visit fee — operator-set, charged on every emergency (requested 2026-06-26)** —
      a NEW operator setting `emergency_visit_fee_cents` (migration + Settings UI),
      charged to the caller **in addition to** the booking deposit when the
      conversation is classified as an emergency (applies to ALL emergencies). Folds
      into the same Stripe Connect Checkout as the deposit. **Decisions (2026-06-26):**
      (a) **platform take rate DOES apply** to the emergency fee, same per-plan rate,
      added on top and charged to the caller — i.e. extend `computeBookingFeeCharge`'s
      deposit base to `booking_fee_cents + emergency_visit_fee_cents` on emergencies;
      (b) **auto-applies on ALL emergencies** when an amount is set (no per-call opt-in);
      (c) **same checkout** as the deposit (one charge). **Partially shipped
      2026-06-26:** ✅ migration `20260626000001_operator_emergency_visit_fee.sql`
      (`operators.emergency_visit_fee_cents`) + db-types + DTO + operators.service +
      Settings UI (field in the Booking fee card) + `computeBookingFeeCharge` now
      accepts `emergencyFeeCents` (adds to the deposit base, platform take applies;
      +2 unit tests). ⬜ **The actual charge wiring is deferred to 17d** — emergencies
      escalate to a human, so the fee gets charged via the human-booking / Slack
      "Send payment request" flow (which passes the emergency amount). Appointments
      don't persist an emergency flag today (`urgency` is only embedded in the
      calendar description), so 17d will also need to flag emergency at charge time.
      So: operators can CONFIGURE the emergency fee now; it CHARGES once 17d ships.
- [ ] **(19) Repeat caller recognition** — if a number has called before, AI
      greets by name and references previous job: `Hi [name], welcome back.
      Last time we helped you with [job]. What's going on today?`

### Slice 18 — Activation & onboarding rebuild

The current funnel has a "calendar trap" — plumbers without Google Calendar
drop at step 4. Activation is the highest-leverage conversion knob.

- [ ] **(7) Onboarding wizard rebuild for plumber-specific friction**:
      - [ ] No Google Calendar? Offer to provision Google Workspace ($6/mo;
        BookingBlues covers it on Starter, plumber covers on Pro; 4-min
        guided flow).
      - [ ] Have Google but never use it? Short video walkthrough of adding it
        to iPhone.
      - [ ] Carrier-forwarding instructions rebuilt with **screenshots for all
        four major carriers** (Verizon, AT&T, T-Mobile, US Cellular). Test
        each on a real phone.
      - [x] **"Schedule a setup call with our team"** button at EVERY step
        — ✅ **shipped 2026-05-14, verified in prod 2026-05-15**. Persistent
        banner above every onboarding step. URL passed to `<Wizard>` as a
        prop from the `/onboarding` Server Component (same Turbopack
        workaround as 16(1)). Current target:
        `cal.com/malhotra-vikas/intro-session-30-minutes`. Hidden when
        unset.
- [ ] **(8) Demo mode toggle** — dashboard button "Demo my product" simulates
      an incoming call to the plumber's Twilio number, runs a fake plumbing
      conversation, books a fake appointment on their calendar marked
      `[DEMO]`. The activation moment that makes them believe. Show on sales
      calls.
- [ ] **(14) Plumber mobile dashboard (PWA)** — mobile-optimized: today's
      bookings, this week's revenue, unread notifications, quick-action
      "mark job done" + "contact customer". PWA only; native app is post-MVP.

### Slice 19 — Plumber business intelligence

Plumbers run their business on intuition. Showing them their numbers — clearly
formatted enough to forward to a spouse who handles bookkeeping — is sticky.

- [ ] **(9) Job-type pricing intelligence** — onboarding captures the
      plumber's pricing for the 15 most common job types ("basic kitchen
      faucet replacement", "water heater swap", etc.). AI quotes price
      ranges to callers, who self-select on price before the plumber
      arrives. Huge for caller-side conversion.
- [ ] **(10) "What you get after every call" — per-booking job summary email**
      (spec refined 2026-06-25) — on every booking, the operator gets a SMS/email
      card so they can **load the truck before driving**. Trade-agnostic (home
      services, not plumbing-only). Card fields, per the agreed mockup:
      ```
      New booking · {business_name}
      Caller   {caller_first_name} · {masked_phone}
      When     {date} {time} ({duration})
      Job      {AI job summary — issue + key detail}
      Likely parts   {AI-inferred parts list for the trade}
      Quoted   {callout fee} + {repair range $X–$Y}
      Deposit  {deposit} secured · payout to your Stripe
      ```
      Data sources: caller/when/job from the `appointments` + conversation
      summary; **Likely parts** and **Quoted range** need (9) job-type pricing
      intelligence + a per-trade parts model (gate this part on (9)); **Deposit
      secured / payout** from the `payments` row (booking-fee flow). The job-card
      itself can ship without (9) by omitting parts/quote. "The feature that gets
      posted about on Reddit."
- [ ] **(11) Daily summary email to the operator — "how the platform helped your
      business"** (spec refined 2026-06-25) — a daily digest emailed to the
      operator: how many calls were caught, how many booked, deposits secured,
      estimated revenue, and a plain-language "KeeprSteady answered N missed calls
      you'd otherwise have lost" framing that makes the platform's value obvious.
      Rebuild the current basic daily summary as a forwardable business report:
      `Yesterday: 4 calls caught, 3 booked, 1 spam, $1,200 booked revenue, $225
      deposits secured. This week: 18 bookings, $5,400. Last week: $4,800 — up 12%.`
      Forwardable to a spouse / bookkeeper. (Distinct from the existing internal
      `daily-summaries.service`, which is an ops digest — this is operator-facing.)
- [ ] **(21) Bookings analytics dashboard** — bookings by day of week,
      average job value over time, call-to-booked conversion rate, no-show
      rate, deposit collection rate. Data the plumber has never had access
      to.

### Slice 20 — Caller-side polish & reviews flywheel

- [ ] **(13) Caller-facing booking confirmation page** — one-page web view:
      `You're booked with [Plumber] on [date/time]. Address: [if needed]. To
      reschedule, text RESCHEDULE to this number.` Looks professional;
      increases show-up commitment.
- [ ] **(18) Review request automation** — 24h after job completion (known
      via Jobber/HCP integration when shipped — see Slice 21), SMS the
      customer: `Hi [name], hope [Plumber] took care of [issue]. If you
      have 30 seconds, a Google review really helps a small business:
      [direct link to their GMB review form].` More Google reviews →
      more inbound calls for the plumber. This is the feature that wins
      plumbers over.

### Slice 21 — Field-service integrations (Jobber, HCP)

This is what justifies Pro pricing and crushes churn at the 3–5-truck size.
Order matters: Jobber first (biggest market segment in our ICP), HCP second,
ServiceTitan deferred until we have 50+ paying customers (bigger ops are not
our immediate ICP).

- [ ] **(12) Jobber integration** — OAuth flow, then on AI-confirmed
      booking, also create the Jobber job with customer details, diagnostic
      notes, estimated price. 2–3 weeks build + test. Goal: listed in
      Jobber Marketplace.
- [ ] **(16) Housecall Pro integration** — same playbook as Jobber, ship
      AFTER Jobber is live + producing happy customers.
- [ ] (deferred) ServiceTitan — bigger segment, not immediate ICP; revisit
      after 50+ customers on the platform.

### Slice 22 — Network effects & AI quality

The investments that compound.

- [ ] **(20) Plumber-to-plumber referral hand-off** — when AI detects a job
      is out of scope for the current plumber (commercial when plumber is
      residential-only, out of service area, specialty work like septic),
      offer to refer to another BookingBlues plumber who covers it. Every
      BB plumber becomes a referral source for every other BB plumber.
      Revenue: $5 referral fee per accepted referral, split between
      platform + referring plumber.
- [ ] **(22) Rebuild the plumbing intake AI with a real plumber
      consultant** — the biggest single product investment. Hire a
      journeyman plumber for 20h at $100/h ($2k total). Elicit:
      - Every diagnostic question they ask on the phone before booking.
      - The 15–20 most common job types + typical pricing ranges.
      - Emergency vs scheduled triage logic ("what makes something a
        drop-everything emergency").
      - Red flags that trigger human handoff (insurance disputes, code
        violations, customers asking for unlicensed work).
      
      Rewrite the GPT-4.1 system prompt to encode this domain knowledge.
      Build a few-shot example library of 30–50 conversations. Test against
      100 simulated calls before going live.

### Sequencing notes

- **Slice 16** is the unblocker — runs first. Cheapest, highest leverage.
- **Slice 17 + 18 + 19** can run in parallel after 16. Different files,
  different surface areas.
- **Slice 21 (Jobber)** is gated on having a real plumber on the platform to
  validate the integration round-trip with. Don't start until 1–2 paying
  plumbers exist.
- **Slice 22 (AI rebuild)** is gated on having interview material from the
  consultant — schedule the 20h block when the plumbing-only landing page
  starts driving signups.

---

## 🎨 Design / UX backlog

- [~] **UI revamp — make it dynamic & polished (requested 2026-06-26, IN PROGRESS)** —
  reference **https://fanmaker.com/**. **Shipped so far (uncommitted):** design system
  (Space Grotesk display font + Inter, brand-purple gradient/glow/shadow tokens, `Reveal`
  scroll-motion, `card-lift`, reduced-motion safety); global display-font headings + a
  global accented gradient background with ambient blobs on every page; homepage
  (gradient hero, elevated cards, numbered step cards, scroll reveal); pricing
  (fanmaker-style tier cards, Crew highlighted); contact cards; shared app primitives
  (SettingsPanel Card, onboarding StepCard, dashboard Stat tile, Nav glass header,
  AuthForm gradient button, auth card). **Verified via Playwright screenshots:** the 9
  public pages look polished + uniform. **NOT visually verified:** the authed pages
  (dashboard/settings/onboarding/admin) — couldn't screenshot due to a sandbox netns
  quirk with the auth-session local server; they inherit the shared primitives + globals
  so should be consistent, but eyeball them after deploy. **Still to do:** per-page polish
  on dashboard/onboarding/admin buttons + layouts. Keep light-only (dark mode removed).
- [ ] **Cal.com demo booking — collect name + email + phone (requested 2026-06-26)** —
  config-only (NOT code): the demo embed (`cal.com/malhotra-vikas/intro-session-30-minutes`)
  books with just the host's details and no phone. In Cal.com → Event Types → [intro
  session] → Advanced → Booking questions: keep Name + Email required, **add a required
  Phone question**, and fix the event title template (was "Host | Host"). Alternative
  considered: build our own demo-request form on `/contact` (name/email/phone → email
  sales) for full control — bigger change, deferred unless we want to drop the Cal embed.

---

## 🗓️ Appointment / invite configurability backlog (requested 2026-06-29)

Surfaced during the §11 booking-loop testing. Tracked, not yet built.

- [ ] **Conversation link on the calendar invite** — add a deep link in the event
  body so the technician can open the live conversation and read up-to-date
  caller details (and any post-booking messages) before/at the visit. Needs an
  operator-authed (or signed-token) conversation view URL to embed in
  `eventDescription` / the booking email.
- [ ] **Operator-configurable service-visit duration** — appointment length is
  currently hardcoded to **60 min** (`check_availability` 60-min slots; booking
  uses the model's start/end). Marketing/FAQ copy says **90 min** — copy and code
  disagree. Add a per-operator `appointment_duration_minutes` setting (Settings +
  onboarding), thread it through availability + booking, and reconcile the FAQ.
- [ ] **Multi-truck / multi-tech capacity (a.k.a. 2b)** — let an operator say how
  many techs/trucks they have so the AI can accept **N concurrent bookings** in
  the same slot (utilize the whole crew) instead of one-at-a-time. Requires a
  per-operator capacity setting + relaxing the single-slot advisory lock / partial
  unique index to allow up to `capacity` confirmed appointments per
  `(operator_id, slot_start)`, and a free/busy check that counts concurrent jobs.

### Related smaller cleanups (also from 2026-06-29 testing)
- [ ] **`job_summary` hygiene** — the AI sometimes folds fee/scheduling chatter
  into `job_summary` (showed up as "Fee No Fee" in a calendar body). Tighten the
  prompt so `job_summary` stays purely the work to be done.
- [ ] **Operator absorbs Stripe processing** — with Direct Charges the operator
  nets `deposit − Stripe fee` (~$241.36 on a $250 deposit). If we want the operator
  to keep a clean $250, add the Stripe fee to what the caller pays. Pricing
  decision, not a bug. (The calendar invite + dashboard now show the operator's
  actual net/payout.)

---

## 🏢 Post-launch — internal tooling / back-office

Not part of the missed-call→booking loop; build after launch once revenue ops need it.

- [ ] **SuiteCRM ↔ Square Payroll integration (requested 2026-06-25)** — stand up
  **SuiteCRM at `crm.keeprsteady.com`** (self-hosted) as the back-office CRM, and
  integrate it with **Square Payroll**. Goal: run the sales/revenue ops + team
  payroll off SuiteCRM rather than ad-hoc tooling. Open questions to resolve when
  scoped: (a) hosting for SuiteCRM (separate box/Railway service + its own
  MySQL); (b) direction + scope of the Square Payroll sync — e.g. push sales-rep
  commission/comp data (from `lead_claims` / impersonation activity / closed
  deals) into Square Payroll, and/or pull payroll status back into CRM; (c) which
  Square API (Payroll API availability + OAuth/app registration); (d) how this
  relates to the existing in-app sales-rep model (`sales_slack_links`,
  `lead_claims`) — likely the CRM is the system of record for comp while the app
  stays the system of record for claims/impersonation. Net-new; no code today.

## 🚫 Out of scope (post-MVP) — per CLAUDE.md §16

Multi-user/teams per Operator · Operator-editable AI prompts · Voice AI (call handling) · Mobile app · Analytics beyond simple counts · Number porting · White-labeling · Multiple calendars per Operator · Outbound campaigns

---

## 📝 Decisions log

Record any deviation from CLAUDE.md here, then update CLAUDE.md in the same PR.

- **2026-05-05** — `EncryptionService` constructor is tolerant of zero keys in dev (defers `crypto.no_keys` error to first encrypt/decrypt). Production env validation still requires `ENCRYPTION_KEY`. Reason: lets the API boot for non-crypto work in dev (health checks, schema introspection) before anyone has filled in `.env.local`.
- **2026-05-05** — Production target is **EC2** (Slice 14), not Railway. Railway remains the staging target (Slice 13). CLAUDE.md §4 and §14 currently say "Railway" only — they will be updated in the PR that lands Slice 14, not before. Reason: user prefers AWS control plane for go-live; Railway is faster for iteration during build-out.
- **2026-05-05** — HITL via **Slack** added as Slice 7.5. Replaces (or augments) the email-only `escalate_to_human` path described in CLAUDE.md §9.3. Triggered when the bot can't help OR the caller asks for a human. Two-way bridging (Slack thread ↔ SMS) so the operator/agent can take over without leaving Slack. Reason: contractors live in Slack/messaging more than email — faster takeover and resolution. CLAUDE.md §3, §4, §9.3, §10, §11 will be updated in the PR that lands this slice.
- **2026-05-05** — `packages/db-types/src/database.types.ts` is hand-written for Slice 2 (only covers `operators` and `webhook_events`). Replaced wholesale by `pnpm gen:db` output the first time it's run (requires Docker + `supabase start`). Reason: Docker isn't installed on the dev machine yet; this lets us ship typed code now and swap in autogen later without code changes.
- **2026-05-05** — `calendar_connections.status` enum (`active`/`revoked`) added beyond what CLAUDE.md §8 lists. Reason: §9.4 requires marking connections revoked on Google 401, and a single-flag column models that more cleanly than a boolean. Will be reflected in CLAUDE.md §8 the next time §8 is touched.
- **2026-05-06** — Migration filename format changed from `<YYYYMMDD>_<NNNN>_<name>.sql` (per CLAUDE.md §8 example) to `<YYYYMMDDHHMMSS>_<name>.sql` (14-digit timestamp). Reason: the Supabase CLI parses everything before the first `_` as the migration version, so all `20260505_NNNN_*` files collapsed to version `20260505` and the second one duplicate-keyed `supabase_migrations.schema_migrations`. CLAUDE.md §8 example is misleading — should be updated in the next doc PR.
- **2026-05-06** — User JWT verification uses `supabase.auth.getUser(token)` (one HTTP call to the Supabase auth API) rather than local HS256 verification with `SUPABASE_JWT_SECRET`. Reason: local Supabase issues asymmetric ES256 tokens with a JWKS endpoint; HS256 with the shared secret no longer works. The remote call is correct in all configs (HS256 / ES256, current / rotated keys). Trade-off: ~5–50ms latency per authenticated request. Swap to local JWKS verification (`jose` library) if/when latency matters; tracked as a follow-up for Slice 11 (observability) where we'll already be measuring request-path performance.
