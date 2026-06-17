# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Resume brief — Monday 2026-06-01 (after weekend; last worked Fri 2026-05-29)

Mac was restarted over the weekend, so all local processes (dev servers,
`stripe listen`, Docker, local Supabase) are stopped. The codebase itself is
in good shape — **everything is committed.**

### State in one paragraph
A full week of KeeprSteady launch-prep shipped and **committed** (HEAD
`0aac035 "Improved brand colors"`): rebrand, Solo/Crew/Fleet billing
migration, terms-acceptance tracking, brand assets/logo, multi-trade
reversal, and the #6B3FA0 accent. Typechecks + `pnpm --filter web build`
pass. **None of it has been smoke-tested on the live system yet** — Monday is
a testing + infra-config day, not a coding day. Local dev is wired to **prod
Supabase** + **BookingBlues Stripe test mode** (see wiring table below).

### Monday action list (priority order)

1. **Confirm commits are pushed to origin.** Working tree is clean except
   `docs/PROGRESS.md` (the Friday progress write-up — commit it). Then
   `git status` should be clean and `git log origin/main..HEAD` empty.

2. **Apply the terms migration to PROD** (if not already done Friday). The
   `operators.terms_*` columns must exist on prod
   (`ozsckjjlydtujbhajjla`) or the signup→operator mirror + accept-terms
   endpoint error out. Verify first:
   - Quick check: the app's `POST /v1/operators/me/accept-terms` or a signup
     completing without a 500 means columns exist. Or run in the Supabase
     SQL editor:
     ```sql
     alter table public.operators
       add column if not exists terms_accepted_at timestamptz,
       add column if not exists terms_version     text;
     ```
   - (The earlier `operator_plan` migration `20260515000001` is already on
     prod; this is the only one possibly outstanding.)

3. **Remove the plumbing-only env vars on Railway** (this is what reopens the
   funnel to all trades — the code already supports it):
   - **web service:** delete `NEXT_PUBLIC_ENABLED_CATEGORIES` (and
     `ENABLED_CATEGORIES` if set there too)
   - **api service:** delete `ENABLED_CATEGORIES`
   - Both are currently `plumbing`. Delete entirely (unset = all 5 trades),
     then **redeploy both**. If you remove only the web one, the API's
     server-side gate (`operators.service.ts`) will reject HVAC/electrical/etc.
     with a 400.

4. **Restart local dev + Stripe forwarding** (only if testing locally; the app
   is wired to prod Supabase so no Docker/local-Supabase needed):
   ```bash
   pnpm dev                                              # web :3000, api :3001
   stripe listen --forward-to localhost:3001/webhooks/stripe
   ```
   ⚠ `stripe listen` prints a **new** `whsec_…` each session — paste it into
   `STRIPE_WEBHOOK_SECRET` in root `.env.local` and **restart the API**
   (dotenv reads at boot). The Friday `whsec_` is dead.

5. **End-to-end billing test** (the big untested path): signup → confirm →
   `/onboarding` step 1 → 3 plan cards + monthly/annual toggle → "Start trial"
   → Stripe Checkout (`4242 4242 4242 4242`) → watch `stripe listen` for
   `checkout.session.completed` + `customer.subscription.created` (200) →
   verify in prod DB:
   ```sql
   select plan, plan_cadence, stripe_price_id, subscription_status
   from operators where id = '<op-id>';
   ```
   All four populated = webhook→DB path works. Repeat Crew-annual +
   Fleet-monthly.

6. **Test the terms re-accept gate:** with a logged-in operator whose
   `user_metadata.terms_version` is stale (or never set), hitting
   `/dashboard` should redirect to `/accept-terms`; accepting returns you to
   the app and stamps `operators.terms_accepted_at`.

7. **Test a non-plumbing emergency SMS** (validates the trade-aware
   classifier change): as an HVAC or electrical operator, text "sparks coming
   from my panel" → operator's phone should get the alert. (Live SMS path —
   confirm it fires for non-plumbing wording.)

8. **Visual QA:** purple accent (#6B3FA0) on CTAs/stats/section labels/nav
   hover/pricing "Most popular"/KeeprSteady table column; logo mark (no text)
   in all three headers (marketing, auth, dashboard); favicon in tab; OG card
   when pasting a link in Slack/iMessage. Check light + dark mode.

### Current wiring (so you don't re-discover Friday's rabbit holes)

| Piece | Points at |
|---|---|
| Web `apps/web/.env.local` Supabase | **prod** `ozsckjjlydtujbhajjla.supabase.co` (208-char anon key) |
| API root `.env.local` Supabase | same prod project |
| Stripe (`STRIPE_SECRET_KEY` etc.) | **BookingBlues** account, **test mode** |
| 6 price IDs | validated on BookingBlues test (Solo/Crew/Fleet × mo/yr) |
| `STRIPE_WEBHOOK_SECRET` | **stale** — regenerate via `stripe listen` Monday |

**Stripe account gotcha:** the Stripe CLI defaults to a *different* account
("Reaper Labs", `acct_1TPSUf…`). KeeprSteady's real account is **"BookingBlues"**
(`acct_1TUVtIBrlSqhHprp`). If `stripe` CLI commands show no Solo/Crew/Fleet
products, you're on the wrong account — `stripe login` → pick BookingBlues.
(Also captured as a reference memory.)

### Carry-overs (unchanged, still open)
- A2P 10DLC brand+campaign (1–3 wk external clock), Resend domain
  verification, Stripe Connect platform enablement, Slack token rotation.
- Email-confirm redirect: add `http://localhost:3000/**` to the prod
  Supabase Auth → Redirect URLs if local signup-confirm bounces to prod.

### Roadmap pointer
Full pending list is in `docs/PROGRESS.md`:
- **Launch-readiness:** Hardening Phases 1–6 (incl. the new **Phase 6
  penetration test**), Slices 10–14 (notifications, Sentry, CI security,
  staging/domain/EC2), rate-limiting + CORS + helmet (flagged as not yet
  implemented).
- **Product (Slices 17–22):** scheduling/triage, activation, business
  intelligence, caller polish, Jobber/HCP, network effects. NOTE: this
  roadmap is still written in plumber-only language — re-generalize to "home
  services" as each slice is picked up (the product itself is now multi-trade).

### Latest commits (local `main`, as of 2026-05-29)
```
0aac035 Improved brand colors
00c7504 Home Services level change
2c5bff8 Logo Fixed
eabf25d Improved logo
e9b70fc Fixed a build error
7ccc421 Added socaol links
e0c33e6 Capturing terms accepted timestamp
6e43395 Push new changes
```
