# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Last session (2026-05-07)

Massive day — went from local-only to **fully deployed staging on Railway with real provider integrations and live E2E flow**.

### Infrastructure stood up

- **GitHub**: pushed to `https://github.com/malhotra-vikas/bookingblues` (was 3 local commits, now 16+)
- **Hosted Supabase** (project `ozsckjjlydtujbhajjla`) — migrations applied via `supabase db push --linked`
- **Railway** — two services live:
  - api: `https://bookingbluesapi-production.up.railway.app`
  - web: `https://bookingbluesweb-production.up.railway.app`
- **Provider creds wired**: Supabase, Stripe (test mode + Connect enabled), OpenAI, Google OAuth (Calendar), Twilio (upgraded out of trial)
- **Deferred**: Sentry, Resend, Stripe Connect webhooks, Google Maps Geocoding (waiting on billing approval)

### Hardening Phase 0 → P0/P1 quick wins shipped

- ✅ Next.js 15.0.0 → **16.2.5** (kills GHSA-f82v-jwr5-mffw middleware-bypass + GHSA-9qr9-h5gf-34mp RCE)
- ✅ `@supabase/supabase-js` bumped (auth-js path-routing fix)
- ✅ `helmet` headers — HSTS preload, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, etc.
- ✅ `CORS` allowlist (only `APP_URL` origin)
- ✅ `@nestjs/throttler` 60/min default, 5/15min on PATCH `/v1/me`, all webhooks `@SkipThrottle()`'d
- ✅ `app.disable('x-powered-by')`

### E2E milestones

| Path | Status |
|---|---|
| Sign up + email confirm via Supabase | ✅ |
| Stripe trial checkout (test card 4242…) → `subscription_status = 'trialing'` via webhook | ✅ |
| Twilio number provisioned, voice + SMS webhooks live | ✅ |
| Inbound call → bot greeting + opening SMS | ✅ |
| Caller reply → OpenAI advance loop runs | ✅ |
| Google Calendar OAuth connected | ✅ |
| Booking actually completes (caller picks slot → calendar event created) | 🔜 untested |
| Trial → paid conversion path | 🔜 deferred (Slice 4-followup) |
| `escalate_to_human` to Slack | ⏳ Slice 7.5 (deferred) |
| Booking-fee charge via Stripe Connect | ⏳ Slice 8 + Connect webhook setup |

### Product features shipped today

- **Trial banner** (dashboard) — "In N-day Trial" pill + "End trial now" with branded confirm modal that explains both success AND failure paths (past_due → "Fix payment method" CTA opens Stripe portal)
- **Branded `<ConfirmModal>`** — replaces every browser `confirm()`/`prompt()`. Severity color stripe (default/warning/danger), type-to-confirm for destructive actions, async confirm with built-in busy state
- **Carrier forwarding picker** (onboarding step 7) — AT&T / Verizon / T-Mobile / Other, GSM dial codes templated with the operator's number, copy buttons, "How to test" disclosure
- **Plain-English wizard copy** — "Get your BookingBlues phone number" not "Provision Twilio number", "Set up payouts" not "Stripe Connect Express onboarding", error messages stripped of HTTP verbiage
- **Per-trade qualification prompts** — replaced Slice 2 placeholders. Each category prompt lists 3-5 questions to ask before booking, with safety carve-outs that route to `escalate_to_human` (gas smell, sparks, structural collapse, etc.)
- **Better out-of-scope handoff** — names the operator's services in plain English ("Acme Plumbing handles leaks, water heaters, drain clogs, fixtures, and pipe repairs")
- **Service area** (onboarding step 8) — explicit ZIP list + radius zones around center ZIPs (`{center_zip:'90210', radius_miles:30}`). `zipcodes` npm for haversine math; expansion happens at prompt-assembly time. Out-of-scope handoff names the covered ZIPs when reason is `outside_service_area`.
- **Booking-fee math display** — operator sees in real time "For a $25 deposit: −$1.03 Stripe + −$2.50 BookingBlues = $21.47 you keep"
- **Default booking fee + take-rate from env** — `DEFAULT_BOOKING_FEE_CENTS`, `PLATFORM_TAKE_RATE_BPS`, mirrored as `NEXT_PUBLIC_*` for the UI math
- **Per-button busy state** in the wizard — disables on click, shows "Saving…", "Getting number…" labels, defends against the double-click race that produced an orphan Twilio number earlier in QA

### New migrations applied to hosted

```
20260507000001_categories_qualification.sql   (real per-trade prompts)
20260507000002_operator_service_area.sql      (operators.service_zip_codes text[])
20260507000003_operator_radius_zones.sql      (operators.service_radius_zones jsonb)
```

### Known issues / parked

- **Twilio orphan**: there's likely an extra `+1...` number on the Twilio account from an earlier double-click. Release in Twilio Console → Active Numbers when convenient ($1.15/mo bleed otherwise).
- **Duplicate Stripe subscriptions**: same root cause earlier (Slice 4-followup tracks the dedup; today's busy-state fix closes the *future* race). Cancel the dupes in Stripe Dashboard → Customers → your customer → Subscriptions tab.

**Repo state**: typecheck clean across 4 packages · **67/67 tests pass** · clean working tree, all changes pushed to main.

---

## Tomorrow

### Top of mind

1. **Test what hasn't been touched yet** — the goal is to walk a real call all the way to a calendar event:
   - Service-area gating: configure 30 mi around 90210, then via SMS supply an in-area ZIP (90211, 90405) → bot should propose slots; new conversation, supply an out-of-area ZIP (92660) → bot should `mark_out_of_scope` with the named-ZIPs handoff
   - Booking actually completes: caller picks a slot → bot calls `book_appointment` → Google Calendar event appears
   - Trial → paid: trigger "End trial now", watch Stripe charge the test card, verify status flips to `active` (or simulate failure with card `4000 0000 0000 9995` to see `past_due` and the red "Fix payment method" CTA)

2. **Pick a feature from the queue** — user has been adding TODOs all day. Top candidates:
   - **Slice 7.5 — HITL via Slack** (escalation visibility)
   - **Slice 15 — Internal admin dashboard** (operator support / dunning / refunds)
   - **Slice 4-followup — billing flow gaps** (trial→paid test, cancellation flow, dedup, past_due degraded mode, trial reminder emails)
   - **Slice 9-followup — `/conversations/:id` transcript view** + appointments cancel UI + business hours editor
   - **UX-followup — loading states elsewhere** (SettingsPanel, TrialBanner, maybe a `useAsyncAction(key, fn)` hook)

3. **Hardening Phase 1** — `docs/SECURITY_REVIEW.md` (auth/crypto/authz/OWASP/route-coverage). Was the original tomorrow plan before infra detoured us; still queued.

### Blocked / waiting

- **Google Maps Geocoding API** (service-area Phase C — city/town centers). Waiting on Google to allow more projects on the user's billing account. Once approved: enable Geocoding API in `bookingblues-staging`, create restricted API key, paste as `GOOGLE_MAPS_API_KEY`, implement `kind:'city'` extension in `service_radius_zones`. Free Nominatim fallback documented.

### Don't forget

- **Custom domain cutover** (Slice 13.5) is fully scoped in PROGRESS.md — every provider URL the operator will eventually need to swap when the real domain is registered. No code changes needed today.
- **CLAUDE.md §8** migration filename example is still wrong (says `20260105_0001_create_operators.sql`; should be 14-digit timestamps). Fix next time §8 is touched.
- **`auth.getUser` 5-50ms** still on every authenticated request. Slice 11 observability is the time to swap to local JWKS via `jose` if latency matters.

---

## Repo state for the resumer

- Branch: `main`, in sync with `origin/main`
- Working tree: clean
- Active services left running:
  - Local Supabase containers (`supabase stop` to tear down)
  - User's `pnpm dev` in their second terminal (api on :3001, web on :3000)
  - Railway services on auto-deploy from `main`

---

## Notes for the next session

- **Don't re-do Phase 0 discovery.** It's in `docs/HARDENING_PHASE_0_FINDINGS.md`. Two of its critical findings (Next.js CVEs) are already resolved.
- **The dev server in the user's terminal might be stale** if they've been testing on Railway exclusively. Either restart locally OR keep using Railway URLs.
- **Twilio + Stripe both have residual test data** from earlier QA — orphan number on Twilio, possibly dupe subscriptions on Stripe. Both are tracked; clean up when convenient.
- **`pnpm gen:db` after any new migration** — local Supabase has all today's migrations applied, so the types in `packages/db-types/` are current as of end of day.
