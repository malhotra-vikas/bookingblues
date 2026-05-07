# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Last session (2026-05-06)

Big day — shipped **Slices 3 → 9** plus **Phase 0** of the hardening engagement.

- **Local stack live** (Docker + Supabase + jest env loading)
- **Slice 3 — Auth + operators** (12 cross-tenant tests)
- **Slice 4 — Billing** (Stripe SaaS subscription, platform webhook handler)
- **Slice 5 — Telephony** (Twilio SDK + provisioning + voice/SMS webhooks + `OUTBOUND_SMS_ALLOWLIST`)
- **Slice 6 — Calendar** (Google OAuth, encrypted refresh tokens, `freeBusy`, `events.insert`, 401→revoked)
- **Slice 7 — AI + conversations** (OpenAI tool dispatch, 7 tools, prompt-injection wrapping, slot dedup index — pg-boss queue deferred)
- **Slice 8 — Payments / Stripe Connect** (Direct Charges, fee cap, refunds w/ `refund_application_fee:true`, Connect webhook envelope check)
- **Slice 9 — Web app** (Tailwind, Supabase auth pages, gated middleware, dashboard, 6-step onboarding wizard, settings, marketing)
- **Phase 0 hardening discovery** — see `docs/HARDENING_PHASE_0_FINDINGS.md`

**Repo state:** typecheck clean across 4 packages · **67/67 tests pass** · API at `:3001` · Web at `:3000` · Supabase Studio at `127.0.0.1:54323`.

---

## Tomorrow — start ~10:00 AM EST

**Goal of the day:** real cloud accounts wired in, ngrok tunnel up, then **walk one missed call all the way through to a booked appointment** end-to-end. Hardening Phase 1 lands inside this so we never run a public URL on the vulnerable Next.js.

### Sequence

1. **(15 min) P0 dependency bumps** — must happen before exposing anything publicly
2. **(45 min) Quick-win API hardening** — CORS / helmet / throttler / `X-Powered-By`
3. **(2–3 hr) Provider account setup** — user-driven, I walk through each
4. **(30 min) Wire env vars + ngrok tunnel + reconfigure webhooks**
5. **(1 hr) E2E smoke test** — sign up → onboarding → simulate a missed call → bot SMS → book appointment
6. **(remainder)** Phase 1 full security review doc, then start Phase 2 CI

### Step 1 — P0 dependency bumps (~15 min)

```bash
pnpm add --filter @bookingblues/web next@latest        # ≥ 15.2.3 — kills BOTH next criticals
pnpm update --filter @bookingblues/api @supabase/supabase-js  # picks up auth-js ≥ 2.70.0
pnpm audit --audit-level=high  # confirm criticals + auth-js high are gone
```

Then `pnpm typecheck && pnpm test && pnpm dev` — verify Slice 9 middleware still gates `/dashboard` (the bumped Next 15.2.3 fix is API-compatible).

### Step 2 — Quick-win API hardening (~45 min)

Files to touch in `apps/api/src/main.ts`:
- `app.disable('x-powered-by')`
- `app.enableCors({ origin: env.APP_URL, credentials: true })` — only the configured Web origin in prod (CLAUDE.md §11.6)
- `app.use(helmet({...}))` with HSTS preload, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy locked down (§11.20)

Add `@nestjs/throttler`:
- Default `{ ttl: 60_000, limit: 60 }` globally (§11.7 60/min)
- `@Throttle({ short: { ttl: 15 * 60_000, limit: 5 } })` on `/v1/me` PATCH and any auth-mutating endpoints
- `@SkipThrottle()` on `/webhooks/*` — Twilio/Stripe retry loops would trip the limiter

Verify: `for i in {1..70}; do curl -sI http://localhost:3001/v1/me; done | grep -c "429"` — should be ≥10.

### Step 3 — Provider account setup (user-driven, I'll walk through each)

Order chosen so dependencies resolve cleanly:

| # | Provider | Action | What to grab | Where it goes |
|---|---|---|---|---|
| 1 | **Sentry** | Create org if needed → 2 projects: `bookingblues-api` (Node) + `bookingblues-web` (Next.js) | DSN for each | `SENTRY_DSN_API`, `SENTRY_DSN_WEB` |
| 2 | **Supabase (hosted)** | New project (US-East). Run our migrations against it: `supabase link --project-ref <ref>` then `supabase db push` | Project URL, anon key, service_role key, JWT secret | `SUPABASE_*` (and `NEXT_PUBLIC_SUPABASE_*` for web) |
| 3 | **Resend** | Sign up, verify a sending domain (or use their test sender) | API key | `RESEND_API_KEY` |
| 4 | **Stripe (test mode)** | New account or test mode in existing. Create 2 Products + recurring Prices: Starter $49/mo, Pro $149/mo. Enable Connect. | Secret key, publishable key, webhook secret (after step 4 below), Connect webhook secret, price IDs | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PUBLISHABLE_KEY` |
| 5 | **OpenAI** | Get API key (use a project-scoped key, not the personal default) | `OPENAI_API_KEY` | env |
| 6 | **Google Cloud Console** | New project. Enable Calendar API. OAuth Consent Screen (External, Testing). OAuth Client (Web app). | Client ID + Secret. **Redirect URI** must match the public ngrok URL from step 4 + `/webhooks/google/oauth/callback` | `GOOGLE_OAUTH_*` |
| 7 | **Twilio** | Sign up. Buy a US local number (~$1.15/mo). | Account SID, Auth Token. We'll set webhook URLs in step 4. Personal phone for `OUTBOUND_SMS_ALLOWLIST`. | `TWILIO_*`, `OUTBOUND_SMS_ALLOWLIST` |
| 8 | **Railway** *(optional today — can defer to Slice 13)* | If we want a public URL today instead of ngrok, create project + 2 services (api, web). Otherwise skip and use ngrok. | `RAILWAY_TOKEN` if scripting, else just paste env in dashboard | provisioned via dashboard |

For today **ngrok is fine** — Railway is Slice 13 anyway. ngrok gives us a stable URL for Twilio + Stripe webhooks + Google OAuth callback.

### Step 4 — Wire env + ngrok + webhook URLs (~30 min)

```bash
# 1. Update apps/api/.env.local with everything from step 3.
# 2. Mirror the NEXT_PUBLIC_SUPABASE_* into apps/web/.env.local.
# 3. ngrok HTTP tunnel (separate terminal):
ngrok http 3001
# Note the https://xxxx.ngrok-free.app URL.

# 4. Update API_URL=https://xxxx.ngrok-free.app in apps/api/.env.local.
#    (The web app stays on localhost; only the API needs to be reachable.)

# 5. Configure provider webhooks against the ngrok URL:
#    Twilio: console → numbers → set Voice + SMS webhooks
#       https://xxxx.ngrok-free.app/webhooks/twilio/voice/<operatorId-after-provisioning>
#       https://xxxx.ngrok-free.app/webhooks/twilio/sms/<operatorId-after-provisioning>
#    Stripe (platform): dashboard → developers → webhooks → endpoint
#       https://xxxx.ngrok-free.app/webhooks/stripe
#       Events: checkout.session.completed, customer.subscription.{created,updated,deleted,trial_will_end}, invoice.payment_{succeeded,failed}
#       Copy the signing secret → STRIPE_WEBHOOK_SECRET
#    Stripe (Connect): same screen → "Listen to events on Connected accounts"
#       https://xxxx.ngrok-free.app/webhooks/stripe/connect
#       Events: account.updated, payment_intent.succeeded, charge.refunded
#       Copy → STRIPE_CONNECT_WEBHOOK_SECRET
#    Google OAuth: redirect URI = https://xxxx.ngrok-free.app/webhooks/google/oauth/callback

# 6. Restart the API so it picks up new env (Web doesn't need restart since it points at API via NEXT_PUBLIC_API_URL).
```

### Step 5 — E2E smoke test (~1 hr)

Walk the value loop with real services:
1. **Sign up** at http://localhost:3000/signup with your email
2. Confirm via the email Supabase sends (real now — no Studio shortcut)
3. **Onboarding step 1** — start the Stripe trial (use Stripe test card `4242 4242 4242 4242`)
4. **Step 2** — pick category (e.g. plumbing)
5. **Step 3** — provision a Twilio number (only if you have credit on the account)
6. **Step 4** — connect Google Calendar (real OAuth dance)
7. **Step 5** — Stripe Connect Express onboarding (test SSN `000-00-0000`, test routing)
8. **Step 6** — set a $25 booking fee
9. **Configure forwarding** on your mobile to the Twilio number (carrier-specific code)
10. **Have a friend call your mobile**, don't answer → forwards to Twilio → caller gets the bot SMS
11. Reply over SMS → bot vets the job → proposes slots → caller picks one → bot books → calendar event appears in your Google → confirmation email arrives via Resend
12. (If fee enabled) caller gets a Stripe Checkout link, pays with `4242…`, payment shows up in dashboard

### Step 6 — Then Phase 1 full security review

Once E2E is green and the dust has settled, write `docs/SECURITY_REVIEW.md` with:
- Findings table (severity / file:line / status)
- Auth review (Supabase password hashing, JWT verification, session revocation)
- Crypto review of `EncryptionService` (IV randomness, tag verification, decrypt failure)
- Authorization route-coverage matrix
- OWASP Top 10 walkthrough with file:line citations
- Now we have real prod-ish URLs to `curl -sI` for the header posture audit

### After Phase 1 (rest of the week)

- **Phase 2** — `.github/workflows/{ci,codeql,trivy,secret-scan,snyk}.yml`, Dependabot, gitleaks. Push to GitHub if not already.
- **Phase 3** — Sentry init across both apps with PII filter + `request_id` tag + dotenv-load-order safety
- **Phase 4** — `docs/RUNBOOK_ENCRYPTION_KEY_ROTATION.md`, branded Resend templates, CORS lockdown verification
- **Phase 5** — auto-generated security report workflow

### Open questions to answer at the top of the day

1. **Push to GitHub** before starting? Phase 2 needs a remote and Stripe/Twilio webhook docs are easier to share via README.
2. **Ngrok account** (free) or Railway today? Either works.
3. **Stripe live mode or test mode?** Test mode is recommended for the first E2E pass — all flows work, no real money. Switch to live during launch prep.
4. **Snyk + Sentry** — confirm whether you want both (Phase 2 + Phase 3) or skip Snyk (free pnpm audit + Dependabot + CodeQL is the floor).

---

## Repo state for the resumer

```
git status: many uncommitted changes (Slices 3-9 not committed).
git log:    3 commits, no remote.
```

**No commits made today** — per CLAUDE.md, only commit when explicitly asked. Tomorrow's first call: commit the Slice 3-9 work in feature groups, push to GitHub, then start Phase 1.

Local services left running: `supabase start` containers + user's `pnpm dev` in their second terminal.

---

## Notes for the next session

- **Don't re-run discovery scans** — Phase 0 findings live in `docs/HARDENING_PHASE_0_FINDINGS.md`.
- **Slice 7 follow-up (pg-boss)** still open. SMS webhook calls `advance.advance` synchronously in a try/catch — eventually-consistent on advance failure.
- **CLAUDE.md §8 migration filename example is wrong** — fix next time §8 is touched.
- **`auth.getUser` 5–50ms** — swap to local JWKS via `jose` if latency matters (~Slice 11).
- **Tomorrow's CRITICAL ordering:** Step 1 (Next.js bump) MUST happen before Step 4 (exposing via ngrok). The middleware-bypass CVE is exploitable on a public URL.
