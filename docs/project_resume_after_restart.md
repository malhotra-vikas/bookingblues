# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Resume brief — 2026-05-16 (start-of-day after 2026-05-15 session)

**Plumbing-MVP cut is LIVE in production** and the first two smoke tests pass.

### What was verified working today (2026-05-15) in prod

- ✅ Trade dropdown on `/onboarding` shows **only Plumbing** (no HVAC,
  Electrical, Roofing, Garage Door)
- ✅ Green "Schedule a setup call with our team" banner appears above
  every onboarding step, linking to
  `cal.com/malhotra-vikas/intro-session-30-minutes`

Got there via an unexpected detour: **Next.js 16's Turbopack production
build does not inline custom `NEXT_PUBLIC_*` env vars** at call sites,
even with the `env: {…}` escape hatch in `next.config.mjs`. This caused
a hydration mismatch (React error #418) where the server rendered the
correct values from Node's `process.env` but the client bundle had
`undefined` for these vars, so React discarded the SSR tree and
re-rendered with the fallback (all 5 categories). Fix: read env in the
`/onboarding` **Server Component** and pass values to the `<Wizard>`
client component as props. Documented in `docs/PROGRESS.md` Slice
16(1). The `env: {…}` block in `next.config.mjs` is now redundant but
harmless; leaving it.

### Still UNVERIFIED in prod from yesterday's smoke checklist

All shipped, deployed, and code-correct — just not yet end-to-end tested
on the live system. Walk through these next session:

- [ ] **STOP opt-out copy (Slice 16(15))** — call your Twilio number,
  hang up, wait for first SMS. Must end with
  `Reply STOP to opt out. Msg & data rates may apply.`
- [ ] **Emergency keyword path (Slice 17(17))** — text "burst pipe in
  my kitchen" → personal phone gets alert within ~1s with the raw
  keyword.
- [ ] **Emergency AI path (Slice 17(17))** — text "water is everywhere
  in the basement, can't shut it off" (no keyword) → alert within ~2s
  with an AI-extracted reason.
- [ ] **Emergency negative case** — text "what time can you come
  Tuesday?" → NO alert, AI advance replies normally.
- [ ] **Lowercase emails (task #45)** — try logging in with
  `MALHOTRA.VIKAS@gmail.com` (mixed case) → should succeed against the
  lowercase row in `auth.users` from yesterday's backfill.

### Feature work to continue next session

Pick up where the plumbing pivot left off. Order suggestion:

**Slice 17 remaining items** (from `docs/PROGRESS.md`):
- (2) Drive-time aware booking + 90-min default slots — needs Google
  Distance Matrix API key + integration. Mid-size piece of work.
- (3) Emergency / urgent / scheduled triage classification — overlaps
  with the AI emergency classifier we already shipped. Could be done
  as a second classifier call or merged into the existing prompt.
- (19) Repeat caller recognition — load prior conversation summary
  into the system prompt when same number calls back.

**Slice 18 remaining items**:
- (7 rest) Google Workspace provisioning offer, iPhone walkthrough
  video, per-carrier (Verizon/AT&T/T-Mobile/US Cellular) forwarding
  screenshots (need real device photos).
- (8) Demo mode toggle on dashboard.
- (14) Plumber mobile dashboard PWA.

**Slices 19–22** — business intelligence, caller polish, Jobber/HCP,
network effects + AI rebuild — all still open.

### Critical-path carry-overs (non-engineering)

These continue to be blocking for "first paying plumber" but aren't
code work:

1. **A2P 10DLC brand + campaign registration with Twilio** — long-pole
   external clock (1–3 week review). File at: Twilio Console →
   Messaging → Regulatory Compliance → A2P 10DLC. Brand info, sample
   messages, opt-in evidence narrative needed.
2. **Resend domain verification** — current sender is
   `onboarding@resend.dev` (test sender, only delivers to
   `malhotra.vikas@gmail.com`). Verify a domain we own with DKIM/SPF/
   DMARC and switch `EMAIL_FROM`.
3. **Stripe Connect platform setup** — user-side blocker (`accounts.create`
   returns "You can only create new accounts if you've signed up for
   Connect"). NOT a launch blocker — plumbers can pay $49/mo without
   ever using booking fees. Defer until first 1–2 plumbers signed up.
4. **Slack token rotation** — bot token + signing secret were pasted
   in chat during earlier debugging. Rotate.

### Cleanup tasks (low priority)

- [ ] Remove the now-redundant `env: { … }` block in
  `apps/web/next.config.mjs`. It was added when we thought it would
  fix the Turbopack inlining; we ended up going the Server-Component
  route. Harmless to keep, but unused.
- [ ] If we ever migrate other UI surfaces (e.g. dashboard, settings)
  to need feature-flagged env vars, use the same Server-Component-prop
  pattern, NOT direct `process.env.NEXT_PUBLIC_*` reads in client
  components. The bug is global to Turbopack's handling of those vars.

### Latest commits (origin/main)

```
2c6a545 Server Component side adding of envs  ← the Turbopack fix
f7d81b8 Debugging envs noty getting loaded
4476bb7 Force NEXT_PUBLIC_* inlining via next.config env block (Turbopack workaround)
8d18c15 Trigger web rebuild for env var pickup
20ddfec Force rebuild for env var pickup
ca34dfc Updazted layouts
e6c2bb8 Plumbing-MVP cut: Slice 16, 17(17 AI hybrid), 18(7 banner), task #45
```

### Reference

- Full slice/todo breakdown: `docs/PROGRESS.md` (Slices 16–22).
- Architecture + non-negotiables: `CLAUDE.md`.
- Critical-path day-by-day timeline to first paying plumber: search
  prior chat transcripts for "First Paying Plumber" section from
  2026-05-14. Roughly 30–35 days from today; A2P 10DLC clock is the
  binding constraint.
