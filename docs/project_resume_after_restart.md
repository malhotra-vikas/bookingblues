# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Resume brief — 2026-05-13 (start-of-day after 2026-05-12 session)

Pick up tomorrow from here. Today's session left several features shipped but
not yet end-to-end verified.

### Verify tomorrow

1. **Conversations (advance lock + heal fix)**
   - Migrations: `pnpm supabase db push` (incl.
     `20260512000005_heal_drifted_escalated_conversations.sql` +
     `20260512000006_advance_lock.sql`).
   - Send 2 SMS quickly to a BookingBlues number. Expect ONE bot reply
     batching both messages. The new `advance_locked_until` column + 3s
     scheduler debounce should prevent the double-reply we saw before.
   - Any older conversations still showing `escalated` on the dashboard
     should be auto-healed back to `awaiting_caller` by the backfill.

2. **Summary emails (NEW today — needs verification)**
   - Per-booking email fires from `BookingsService.book()` (fire-and-forget;
     non-fatal on failure). Includes caller details, time, fee, full
     transcript, Google Calendar deep link.
   - Daily summary endpoint: `POST /v1/internal/daily-summaries/run` with
     header `X-Cron-Secret: <CRON_SHARED_SECRET>`. Idempotent via
     `daily_summary_sends` table.
   - **Required env on Railway api:** `RESEND_API_KEY`, `EMAIL_FROM`,
     `CRON_SHARED_SECRET` (`openssl rand -hex 32`).
   - **Current sender setup (TEMPORARY):** using Resend's shared test sender
     `onboarding@resend.dev`. Works with any Resend API key but Resend will
     only deliver to the email address registered on the Resend account.
     Sufficient for verifying the booking-email + daily-summary plumbing to
     your own inbox.
   - **TODO — production sender:** sign up for Resend with a domain we
     control, verify DKIM/SPF/DMARC in the Resend dashboard, then switch
     `EMAIL_FROM` to `BookingBlues <bookings@<domain>>`. Until then any
     operator/caller email address other than the Resend-account email will
     bounce silently (logged warn; booking still succeeds).
   - **Daily cron wiring:** set up Railway cron OR an external scheduler to
     POST `/v1/internal/daily-summaries/run` once a day (recommended ~09:00
     UTC). Each operator's metrics are bucketed in their own timezone.
   - Migration: `20260512000007_daily_summary_sends.sql`.

3. **Lead claim flow**
   - Sign up a fake account from the web app → `#bb-leads` Slack channel
     should get a post with full email + business name + `[Claim this lead]`
     + `[View in admin]` buttons.
   - Click "Claim this lead" → message should swap to show
     `🔒 Claimed by @you`; buttons vanish to prevent race-claims.
   - `/admin/leads` should show the Slack username in the new "Owner" column.
   - **Required env on Railway api:** `SLACK_CHANNEL_LEADS_ID` (user already
     added `C0B3JB7QJ9J`).
   - **Required Slack setup:** `/invite @bookingblues` in `#bb-leads`
     — otherwise the post fails with `channel_not_found`.
   - Migration: `20260512000004_lead_claims.sql`.

4. **Dark mode**
   - Toggle works site-wide. Admin pages, dashboard, settings, onboarding,
     auth pages, leads, operators table, operator dossier — all polished.
   - Landing page sections + a few inner wizard fragments (booking-fee
     economics box) still render light-styled but readable.

5. **Stripe Connect — still inoperational**
   - Outstanding from earlier sessions. `accounts.create` returns "You can
     only create new accounts if you've signed up for Connect". User-side
     blocker — either complete the Stripe platform setup in Sandbox mode
     or switch to classic Test mode in the Stripe dashboard.
   - Not a code issue. The eligibility gating in `PaymentsService` and
     `isBookingFeeCollectible` will silently route around Connect being
     down (bookings still happen, just without a fee).

### TODO for tomorrow

- **Lowercase emails at signup** (task #45). Customers may type uppercase
  in the email field at signup. Today the Supabase Auth row stores whatever
  was typed, which can break login if they enter the email differently
  later. Fix path: normalize via `.trim().toLowerCase()` in `AuthForm.tsx`
  before both `supabase.auth.signUp({ email })` and
  `signInWithPassword({ email })`. Add a DB migration to lowercase existing
  `auth.users.email` rows. Supabase Auth is case-sensitive — confirm
  whether an Auth Hook is needed to enforce it server-side as well.

- **Verify per-booking email + daily summary deliverability.** First send
  should go to your own address to confirm DKIM/SPF + the Resend domain
  is verified.

- **Wire the daily-summary cron.** Once verified, configure Railway cron
  (or an external scheduler) to hit `/v1/internal/daily-summaries/run`
  daily with the `X-Cron-Secret` header.

- **Migrations to apply** (forward-only, in order):
  - `20260512000004_lead_claims.sql`
  - `20260512000005_heal_drifted_escalated_conversations.sql`
  - `20260512000006_advance_lock.sql`
  - `20260512000007_daily_summary_sends.sql`

- **Slack token rotation.** The bot token + signing secret were pasted into
  chat during debugging earlier. Rotate before broader use.

### Reference

- Source of truth for what's built / pending: `docs/PROGRESS.md`.
- Architecture + non-negotiables: `CLAUDE.md`.
- Slack setup: `docs/SLACK_SETUP.md`.
