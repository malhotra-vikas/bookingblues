# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Resume brief — 2026-05-14 (start-of-day after 2026-05-13 session)

**Big shift today: product is pivoting to plumbing-only MVP.** All non-plumbing
trades feature-flagged off, plumber-specific landing + emergency flow + activation
rebuild. Slices 16–22 of `docs/PROGRESS.md` capture the full roadmap.

### What shipped today (all pushed to main)

- **Issue 1 — duplicate bot replies on rapid-fire caller SMS** — fixed via
  "latest message must be caller" guard at the top of
  `apps/api/src/modules/ai/advance.service.ts:advance()`. Closes the sequential
  race the cross-replica lock didn't cover.
- **Issue 2 — new conversation thread after `book_appointment`** — fixed via
  60-min resume window in
  `apps/api/src/modules/conversations/conversations.service.ts:getOrCreate`.
  Follow-up caller SMS within 60 min of a `completed` convo reopens that row
  so the Slack thread + AI context stay continuous.
- **SMS delivery markers in #convos** — Twilio `statusCallback` →
  `POST /webhooks/twilio/status` (new `TwilioStatusController`). Bot echoes
  post with ⏳ prefix and edit to ✅ / ❌ on delivery / failure via
  `chat.update`. Agent-bridged messages get reactions (`:hourglass:` →
  `:white_check_mark:` / `:x:`). Slack can't `chat.update` someone else's
  message, hence reactions for the agent case.
- **Zod-recovery in tool dispatch** — `BookAppointmentArgs.parse` used to
  throw on empty `caller_name` and crash the entire advance. Now the error
  is fed back to the model as a tool response so it self-corrects (re-asks
  the caller for their name). Same pattern for every tool.
- **Test DI + skip-on-Supabase-down** — `EmailModule` added to
  `AppointmentsModule`, `SlackApiClient` exported from `SlackModule`.
  Integration specs (cross-tenant / rls / stripe-webhook / twilio-webhook)
  now skip cleanly when local Supabase isn't running instead of flooding
  VS Code Problems with 25 reds.
- **Admin operators table** — new "Email" column next to Twilio Number.
  "Connect" labels renamed to "Stripe Connect" throughout admin views.
- **Plumbing pivot roadmap** — 21 items captured as Slices 16–22 in
  `docs/PROGRESS.md`. Themes: plumbing-only collapse · scheduling/emergency
  triage · activation rebuild · business intelligence · caller polish ·
  Jobber/HCP integration · network effects + AI quality investment.

### Critical-path focus for tomorrow

Sequence below targets **first paying plumber ~30–35 days from today**, with
A2P 10DLC carrier review as the long-pole external clock.

1. **File A2P 10DLC brand + campaign registration with Twilio** — DO THIS
   FIRST. Day-1 task because 1–3 week review window defines the timeline.
   Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC.
   - Need: brand info (legal name, EIN, address, website), campaign use case
     "Mixed", sample messages (paste from current `🤖 Bot:` echo text),
     opt-in evidence (caller-initiated forwarding flow + STOP copy).

2. **Slice 16 — Plumbing-only collapse** (`docs/PROGRESS.md`):
   - **(1)** Feature-flag non-plumbing categories everywhere (signup,
     landing, dashboard, onboarding wizard). Don't delete — env-gate via
     `ENABLED_CATEGORIES=plumbing` or `categories.enabled` column.
   - **(4)** Plumber-specific landing + signup. Hero: photo of plumber on
     a job. Headline "Plumbers: Never miss another emergency call."
     Subhead "AI books your jobs by text while you're on the wrench."
     Single CTA "Start free 7-day trial." Plumber-tuned FAQ.
   - **(15)** A2P 10DLC opt-in compliance copy on first AI message:
     "Reply STOP to opt out. Msg & data rates may apply." Track opt-outs
     in DB; honor STOP via Twilio + our own gate.

3. **Resend domain verification** — sign up Resend with a domain we
   control, verify DKIM/SPF/DMARC. Until then, per-booking email + daily
   summary only deliver to `malhotra.vikas@gmail.com` (Resend test sender
   restriction). Currently using `onboarding@resend.dev` as a placeholder.

4. **Slice 17 partial — emergency keyword detection (item 17)** — ship just
   the keyword classifier and immediate-SMS-to-plumber on burst pipe / gas
   smell / sewage backup / etc. AI takes over only if plumber doesn't
   respond in 60s. Cheap to ship; the single most visible win.

5. **Slice 18 minimum viable activation**:
   - Carrier-forwarding screenshots for Verizon, AT&T, T-Mobile, US
     Cellular — tested on a real phone for each.
   - "Schedule a setup call with our team" button at every step of the
     onboarding wizard. For customer #1 you'll do this onboarding personally
     over Zoom anyway.
   - SKIP for now: Google Workspace provisioning, iPhone walkthrough
     video, mobile dashboard PWA.

### Still-open carry-overs from previous days

- **Stripe Connect setup** — user-side blocker, NOT a code issue.
  `accounts.create` returns "You can only create new accounts if you've
  signed up for Connect". Either complete Stripe platform setup in
  Sandbox mode or switch to classic Test mode. The eligibility gating
  in `PaymentsService.ensureFeeEligible` silently routes around Connect
  being down — bookings still happen, just without a fee. **Not a launch
  blocker — plumbers can pay $49/mo subscription with zero fee
  involvement. Defer until first 1–2 plumbers signed up.**

- **Lowercase emails at signup** — normalize via `.trim().toLowerCase()`
  in `apps/web/components/AuthForm.tsx` before both `signUp` and
  `signInWithPassword`. DB migration to lowercase existing
  `auth.users.email` rows. Confirm whether an Auth Hook is needed
  server-side too (Supabase Auth is case-sensitive).

- **Verify per-booking + daily summary email deliverability** — first send
  must go to `malhotra.vikas@gmail.com` (the Resend account email) since
  we're on `onboarding@resend.dev` until domain verification.

- **Wire daily-summary cron** — once Resend is verified, configure Railway
  cron (or external scheduler) to POST
  `/v1/internal/daily-summaries/run` daily with `X-Cron-Secret`.
  Recommended ~09:00 UTC; each operator's metrics are bucketed in their
  own timezone.

- **Slack token rotation** — bot token + signing secret were pasted into
  chat during earlier debugging. Rotate before broader use.

### Sales — parallel track (don't wait for engineering)

- Build target list: 5–10 named plumbers reachable via warm intros, local
  trade groups, Facebook plumber groups, blue-collar subreddits,
  supply-house contacts. Skip cold outbound — product is too new for cold
  to convert.
- Offer: 30-day free trial (vs default 7), personal Zoom onboarding, your
  direct number for issues, $0/mo for first 60 days of paid use in
  exchange for testimonial + feedback.
- Be ready to babysit Slack threads in real time during customer #1's
  first week. Slice 7.5 HITL exists exactly for this — use it.

### Reference

- **Critical path doc** (Day → first paying plumber): see end of this
  session's chat for the day-by-day breakdown.
- Source of truth for what's built / pending: `docs/PROGRESS.md`
  (Slices 16–22 are the plumbing pivot roadmap).
- Architecture + non-negotiables: `CLAUDE.md`.
- Slack setup: `docs/SLACK_SETUP.md`.
