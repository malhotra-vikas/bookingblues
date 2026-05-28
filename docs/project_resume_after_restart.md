# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Resume brief — 2026-05-28 (start-of-day after 2026-05-27 session)

Two large bundles shipped in code on 2026-05-27, **neither tested in prod**:

1. **KeeprSteady rebrand + legal/marketing launch prep** (≈17 spec items)
2. **Billing migration**: Starter/Pro → Solo/Crew/Fleet × monthly/annual

Source spec docs:
- `/Users/vikas/Downloads/files(1)/KeeprSteady_Edit_Specs.docx`
- `/Users/vikas/Downloads/files(1)/KeeprSteady_Legal_Docs.docx`

Both `pnpm --filter api typecheck` and `pnpm --filter web typecheck` pass
clean as of end-of-day 2026-05-27. **Everything is uncommitted** — the
working tree is dirty.

### What's blocking actually going live (user task list for 2026-05-28)

1. **Create 6 Stripe prices** in the Dashboard (or via API). Three products
   ("KeeprSteady — Solo", "Crew", "Fleet"); each with a monthly and annual
   recurring price. Amounts:
   - Solo: $49/mo ($4,900 cents) and $490/yr ($49,000 cents)
   - Crew: $650/mo ($65,000 cents) and $6,500/yr ($650,000 cents)
   - Fleet: $1,499/mo ($149,900 cents) and $14,990/yr ($1,499,000 cents)

   Drop the six `price_…` IDs into env:
   - `STRIPE_PRICE_SOLO_MONTHLY`, `STRIPE_PRICE_SOLO_ANNUAL`
   - `STRIPE_PRICE_CREW_MONTHLY`, `STRIPE_PRICE_CREW_ANNUAL`
   - `STRIPE_PRICE_FLEET_MONTHLY`, `STRIPE_PRICE_FLEET_ANNUAL`

   The old `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` were removed
   wholesale (no grandfathering — pre-launch, no live paying subs).
2. **Run the migration**: `pnpm db:migrate` (or whatever the deploy pipeline
   uses). New file is `supabase/migrations/20260515000001_operator_plan.sql`.
   Adds three nullable columns to `operators` (`plan`, `plan_cadence`,
   `stripe_price_id`) — won't break existing rows.
3. **Verify the marketing site loads** in `pnpm dev`. Walk through:
   - `/` — home services hero, no "BookingBlues" anywhere, no placeholder
     testimonial, dashboard/job-brief mockups visible, competitive table
     renders.
   - `/pricing` — three tiers, monthly/annual toggle works, Crew has the
     "Most popular" badge, inline FAQ accordion opens/closes, HITL +
     alignment callouts visible.
   - `/contact` — Cal.com iframe loads (or shows the "open in new tab"
     fallback).
   - `/privacy` and `/terms` — full pages render, no broken layout in
     the Tailwind arbitrary variants (`[&_h3]:...`).
   - `/faq` — 15 entries, no plumber-only framing.
   - `/signup` — ToS consent checkbox blocks submit; skeleton renders
     while the form initialises (no "Loading…" text).
   - Footer disclaimer paragraph + LinkedIn icon + Privacy/Terms links
     visible on every page.
4. **Test the wizard plan picker end-to-end**:
   - Log in to a fresh test operator account.
   - Hit `/onboarding` step 1 (Subscribe). Verify the three plan cards
     render with the cadence toggle.
   - Click "Start trial — Solo" on monthly. Should redirect to Stripe
     Checkout. Complete with test card `4242 4242 4242 4242`.
   - On return to `/dashboard?subscription=success`, check the DB:
     ```sql
     SELECT id, plan, plan_cadence, stripe_price_id, subscription_status
     FROM operators WHERE id = '<your-test-op-id>';
     ```
     All four columns should be populated by the
     `customer.subscription.created` webhook. If `plan`/`plan_cadence`
     are NULL but `stripe_price_id` is set, the metadata path failed —
     check the Stripe Dashboard event log for the subscription's
     metadata.
   - Repeat for Crew annual + Fleet monthly to cover all three plans
     and both cadences.
5. ~~**Drop in asset files**~~ ✅ **DONE 2026-05-28.** Generated from the
   logo/favicon the user provided (`~/Downloads/favicon.jpg` = K lettermark
   on black; `~/Downloads/canvas.png` = transparent KEEPRSTEADY wordmark).
   `apps/web/public/` now has: `favicon.ico` (16/32/48 multi-res),
   `icon.png` (32), `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`
   (180), `og-image.png` (1200×630 — wordmark centred on black).
   `app/layout.tsx` `icons` metadata updated to reference the PNG set.
   Verify the favicon shows in the browser tab and the OG card renders in
   a LinkedIn/iMessage paste once deployed.
6. **Replace the LinkedIn placeholder** in `apps/web/lib/brand.ts`
   (`linkedinUrl`) once the company page is published. Currently
   `https://www.linkedin.com/company/keeprsteady` — likely 404s.
7. **Commit the diff**. It's large (~30 modified files, 6 new files, 1
   migration). Suggested split into two commits if you want clean history:
   one for the rebrand/legal/marketing changes, one for the billing
   migration. Both depend on the new `lib/brand.ts` so order matters
   if you split.

### Carry-overs from earlier sessions (still open)

These were on the radar before 2026-05-27 and remain so:

- **A2P 10DLC** brand + campaign with Twilio (1–3 week clock).
- **Resend domain verification** (current `EMAIL_FROM` is the test sender
  `onboarding@resend.dev`, only delivers to your Gmail).
- **Stripe Connect platform setup** (user-side blocker; not a launch
  blocker for $49/mo Solo subs without deposits).
- **Slack token rotation** (bot token + signing secret were pasted in
  chat during earlier debugging).
- **Slice 16 verification leftovers** — STOP opt-out copy, emergency
  keyword path, emergency AI path, emergency negative case, lowercase
  email login. All shipped but the in-prod walkthrough never happened.

### Intentionally NOT done in this session — flag if you want them

- **SalesCalculator rename** — internal admin tool still uses
  `'starter'|'pro'|'enterprise'` for commission tiers (different
  prices, different purpose from billing). Untouched.
- **OG image, favicon, apple-touch-icon assets** — code hookup is in,
  files aren't.
- **ED-26 robots.txt / sitemap.xml** — not in scope; route list to
  include when ready: `/`, `/pricing`, `/faq`, `/privacy`, `/terms`,
  `/contact`.
- **ED-27 branded 404 page** — not in scope.
- **ED-30 SMS demo trade toggle on homepage** — not in scope (would
  need three trade-specific demo scripts).
- **ED-31 post-signup onboarding checklist + drip email sequence** —
  not in scope (multi-day feature on its own).
- **Backwards compat for any live Starter/Pro subs** — none exist
  pre-launch. If a test sub from earlier QA happens to be sitting on
  one of those old prices in Stripe, its next webhook will leave
  `plan`/`plan_cadence` NULL (metadata won't have the new keys) and
  only `stripe_price_id` will populate. Acceptable.

### Latest commits (origin/main, as of 2026-05-27)

```
1be994e Progress from today. We will continue tomorrow
2c6a545 Server Component side adding of envs  ← the Turbopack fix
f7d81b8 Debugging envs noty getting loaded
4476bb7 Force NEXT_PUBLIC_* inlining via next.config env block (Turbopack workaround)
```

The 2026-05-27 work is **not** in any of these — still uncommitted
working tree.

### Reference

- Full session detail: `docs/PROGRESS.md` → "KeeprSteady launch prep +
  billing migration" entry (inserted before Slice 17).
- Marketing copy + spec source: the two `.docx` files in
  `~/Downloads/files(1)/`.
- Plan data is in one place: `apps/web/lib/brand.ts` (`PLANS` array).
  Edit there and both `/pricing` and the Wizard pick up the change.
- Architecture + non-negotiables: `CLAUDE.md`.
