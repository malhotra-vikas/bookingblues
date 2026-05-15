# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Resume brief — 2026-05-15 (start-of-day after 2026-05-14 session)

**Status: Plumbing-MVP cut is code-complete locally.** Today landed all of
Slice 16, the upgraded Slice 17(17), the cheap part of Slice 18(7), and task
#45 (lowercase emails). Code is uncommitted in working tree — user planned
to commit + push.

### What shipped today (in working tree, not yet pushed unless user committed)

| Slice | Item | Status |
|---|---|---|
| 16 | (1) Feature-flag non-plumbing categories | ✅ |
| 16 | (4) Plumber-specific landing + FAQ | ✅ |
| 16 | (15) STOP opt-out compliance copy | ✅ |
| 17 | (17) Emergency detection — keyword + AI hybrid (`gpt-4.1-mini`) | ✅ |
| 18 | (7) Schedule-setup-call banner on every onboarding step | ✅ (partial — Google Workspace, carrier screenshots, iPhone video still open) |
| #45 | Lowercase emails at signup + migration | ✅ |

### Files changed (10 modified + 3 new)

API:
- `apps/api/src/config/env.ts` — `ENABLED_CATEGORIES` + `SETUP_CALL_BOOKING_URL` + parsed `ENABLED_CATEGORY_SET` on `Env`
- `apps/api/src/common/openai/openai.service.ts` — added `CLASSIFIER_MODEL = 'gpt-4.1-mini'`
- `apps/api/src/modules/operators/operators.service.ts` — server-side category gate
- `apps/api/src/modules/webhooks/twilio-voice.controller.ts` — STOP copy in opening SMS
- `apps/api/src/modules/webhooks/twilio-sms.controller.ts` — keyword + AI emergency alert wiring
- `apps/api/src/modules/conversations/conversations.module.ts` — imports OpenAIModule, exports classifier
- `apps/api/src/modules/conversations/emergency-detection.ts` (new) — keyword matcher
- `apps/api/src/modules/conversations/emergency-classifier.service.ts` (new) — AI classifier

Web:
- `apps/web/lib/env.ts` — `NEXT_PUBLIC_ENABLED_CATEGORIES` + `NEXT_PUBLIC_SETUP_CALL_BOOKING_URL`
- `apps/web/components/onboarding/Wizard.tsx` — category filter + persistent setup-call banner
- `apps/web/components/AuthForm.tsx` — `.trim().toLowerCase()` on email at signup + signin
- `apps/web/app/(marketing)/page.tsx` — plumber-specific hero, copy, SMS mockup, single CTA
- `apps/web/app/(marketing)/faq/page.tsx` — 8 plumber-objection entries

DB:
- `supabase/migrations/20260514000001_lowercase_auth_emails.sql` (new) — backfill with collision-skip safety

Misc:
- `.env.example` — documents new vars + `SETUP_CALL_BOOKING_URL` set to `cal.com/malhotra-vikas/intro-session-30-minutes`

### Deploy steps before testing

1. **Push the commit to GitHub** so Railway auto-deploys both api + web services.

2. **Paste this SQL into Supabase SQL Editor** (lowercase email backfill):

   ```sql
   do $$
   declare
     conflict_count int;
   begin
     select count(*) into conflict_count
     from auth.users u1
     where u1.email is not null
       and u1.email <> lower(u1.email)
       and exists (
         select 1 from auth.users u2
         where u2.id <> u1.id and u2.email = lower(u1.email)
       );
     if conflict_count > 0 then
       raise notice 'Lowercase email collisions on % rows — review manually.', conflict_count;
     end if;
   end$$;

   update auth.users
   set email = lower(email)
   where email is not null
     and email <> lower(email)
     and not exists (
       select 1 from auth.users u2
       where u2.id <> auth.users.id
         and u2.email = lower(auth.users.email)
     );
   ```

3. **Add 4 new env vars on Railway** (2 per service):

   **API service:**
   ```
   ENABLED_CATEGORIES=plumbing
   SETUP_CALL_BOOKING_URL=https://cal.com/malhotra-vikas/intro-session-30-minutes
   ```

   **Web service:**
   ```
   NEXT_PUBLIC_ENABLED_CATEGORIES=plumbing
   NEXT_PUBLIC_SETUP_CALL_BOOKING_URL=https://cal.com/malhotra-vikas/intro-session-30-minutes
   ```

   ⚠️ `ENABLED_CATEGORIES` and `NEXT_PUBLIC_ENABLED_CATEGORIES` must MATCH on
   the two services. If they drift the wizard shows categories the API
   will reject.

### Smoke checklist after deploy

Run these in order. Each one validates a specific slice that shipped today.

- [ ] **Landing page (Slice 16(4))** — visit prod web URL. Hero must read
      "Plumbers: never miss another emergency call." If still see the old
      "first to answer wins the job", the web deploy hasn't picked up.
- [ ] **Plumbing-only signup (Slice 16(1))** — fresh test signup. The
      onboarding wizard's "Pick your trade" dropdown should show **only
      Plumbing**, not 5 trades. Also: server-side direct PATCH attempt
      with `category: "hvac"` should return 400 with
      `Category "hvac" is not currently enabled. Available: plumbing.`
- [ ] **Setup-call banner (Slice 18(7))** — open the wizard logged in.
      Green banner at the top with "Schedule a setup call" button →
      should open `cal.com/malhotra-vikas/intro-session-30-minutes` in a
      new tab. Banner persists across every step.
- [ ] **STOP opt-out copy (Slice 16(15))** — call your Twilio number, hang
      up, wait for the first SMS. Must end with `Reply STOP to opt out.
      Msg & data rates may apply.`
- [ ] **Emergency detection — keyword path (Slice 17(17))** — text "burst
      pipe in my kitchen" to your Twilio number from your test phone.
      Within ~1s your `personal_phone_e164` should receive an alert SMS
      `🚨 EMERGENCY CALL — <business>. Caller •••NNNN reports "burst
      pipe". Call them back: +1NNN…`
- [ ] **Emergency detection — AI path (Slice 17(17))** — text "water is
      everywhere in the basement, can't shut it off" (no keyword match).
      Within ~2s your `personal_phone_e164` should get a similar alert
      but with an AI-extracted reason like
      `Caller •••NNNN reports: basement flooding, water won't shut off.`
- [ ] **Emergency detection — negative case** — text "what time can you
      come Tuesday?" — should NOT trigger an alert. AI advance reply
      should still happen normally.
- [ ] **Lowercase emails (task #45)** — try logging in with email typed in
      different case (e.g. `MALHOTRA.VIKAS@gmail.com`). Should succeed.

### Tuning knobs (no rebuild needed)

- Emergency-detection sensitivity lives in the system prompt of
  `apps/api/src/modules/conversations/emergency-classifier.service.ts`.
  If you're getting false positives, tighten the prompt further. If
  missing real emergencies, soften.
- Keyword list is in `apps/api/src/modules/conversations/emergency-detection.ts`
  — add domain-specific terms as you hear them on real calls.

### Critical-path carry-overs (NOT shipped — open work)

In priority order for first paying plumber:

1. **A2P 10DLC brand + campaign registration with Twilio** — 1–3 week
   external clock. File at: Twilio Console → Messaging → Regulatory
   Compliance → A2P 10DLC. Need brand info, sample messages, opt-in
   evidence narrative ("caller-initiated forwarding flow + STOP copy"
   in opening SMS).
2. **Resend domain verification** — current sender `onboarding@resend.dev`
   only delivers to `malhotra.vikas@gmail.com` (Resend test-sender
   restriction). Verify a domain you own (DKIM/SPF/DMARC) and switch
   `EMAIL_FROM`.
3. **Stripe Connect platform setup** — user-side blocker. `accounts.create`
   returns "You can only create new accounts if you've signed up for
   Connect." NOT a launch blocker — plumbers can pay $49/mo without
   ever using booking fees. Defer until first 1–2 plumbers signed up.
4. **Slack token rotation** — bot token + signing secret were pasted in
   chat during earlier debugging. Rotate.
5. **Daily-summary cron wiring** — once Resend is verified, configure
   Railway cron (or external scheduler) to POST
   `/v1/internal/daily-summaries/run` daily with `X-Cron-Secret`.

### Still-open items inside today's slices (deferred from scope)

These are tracked in PROGRESS.md Slices 17–22:

- **17(2)** Drive-time aware booking + 90-min default slots (needs Google
  Distance Matrix API key + integration)
- **17(3)** Emergency / urgent / scheduled triage classification (overlaps
  with 17(17); revisit after live-call data shows what's needed)
- **17(19)** Repeat caller recognition (load prior conversation history into
  the system prompt)
- **18(7)** remainder — Google Workspace provisioning, iPhone walkthrough
  video, per-carrier screenshots (Verizon, AT&T, T-Mobile, US Cellular —
  need real device photos)
- **18(8)** Demo mode toggle
- **18(14)** Plumber mobile dashboard PWA
- Slices 19–22 (business intelligence · caller polish · Jobber/HCP · network
  effects + AI rebuild) — all still open

### Reference

- Source of truth for what's built / pending: `docs/PROGRESS.md`
  (search for `Slice 16`, `Slice 17`, `Slice 18` to see shipped/pending
  breakdown).
- Architecture + non-negotiables: `CLAUDE.md`.
- Slack setup: `docs/SLACK_SETUP.md`.
- Last 30–35 day critical-path doc (target: first paying plumber): see
  resume brief from 2026-05-14 session, scroll back in chat for the
  day-by-day Day 0 → Day 35 timeline.
