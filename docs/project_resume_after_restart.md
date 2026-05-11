# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## ⚡ First thing tomorrow — Slice 15 + 7.5 verification

Status going in: code shipped + deployed to Railway (commits `b955847`, `4619da0`), build green, Slack app created in api.slack.com with secrets pasted into Railway env. **Untested end to end.** This is the verification flow we planned at end of day.

### Pre-flight (one-time, ~2 min)

1. **Apply the new migrations to hosted Supabase** (in case the Railway pre-deploy didn't):
   ```
   supabase db push --linked
   ```
   Two migrations should apply: `20260511000001_admin_role_helper.sql` + `20260511000002_hitl_slack.sql`.

2. **Promote yourself to admin** in the Supabase SQL editor (project `ozsckjjlydtujbhajjla`):
   ```sql
   select admin_promote('malhotra.vikas@gmail.com');
   ```

3. **Regenerate db-types** so `escalations` + `slack_connections` become first-class — retires the `as any` casts in `admin-read.service.ts` (`countEscalationsOpen`) and across `slack-*.ts`:
   ```
   pnpm gen:db
   ```
   Then in a follow-up commit, replace the `as any` casts. Search for `eslint-disable-next-line @typescript-eslint/no-explicit-any` in `apps/api/src/modules/slack/` and `apps/api/src/modules/admin/admin-read.service.ts`.

### Smoke test 1 — Admin dashboard (Slice 15, ~2 min)

4. Hard-reload `https://bookingbluesweb-production.up.railway.app/admin` — you should land on the red-banner **Overview** page, not get redirected to `/dashboard`. If you're redirected, step 2 didn't take.

5. Click into `/admin/operators` → your test operator → confirm the dossier loads with: stats grid, provider deep-links (Stripe customer / subscription / Connect account / Twilio number sid), the Conversations / Appointments / Payments / Audit log tabs.

6. **Don't** click Deactivate or Refund yet — those are real Stripe/Twilio side effects. Just verify the modal opens, type-business-name confirm gate appears, and Cancel dismisses cleanly.

### Smoke test 2 — Slack install (Slice 7.5, ~3 min)

7. In an authenticated operator session, hit the install endpoint (curl works; there's no dashboard button yet — that's a small UX follow-up):
   ```bash
   # Grab JWT from a logged-in browser tab: DevTools → Application →
   # Cookies → `sb-<project-ref>-auth-token` → the access_token field
   TOKEN="<paste here>"
   curl -H "Authorization: Bearer $TOKEN" \
     https://bookingbluesapi-production.up.railway.app/v1/operators/me/slack/install
   ```
   Returns `{ url: "https://slack.com/oauth/v2/authorize?..." }`. Open the URL → approve → land back on `/settings/slack?ok=1`.

8. **Invite the bot to the channel** Slack picked during install: `/invite @BookingBlues` in that channel. (The default-channel install flow gets `not_in_channel` if you skip this — failure mode #2 below.)

### Smoke test 3 — End-to-end HITL bridge (Slice 7.5, ~5 min)

This is the load-bearing test for the whole slice. Needs the test caller phone and the operator's Twilio number.

9. **Trigger an escalation** — text the operator's Twilio number from the test caller phone: `can I talk to a human?`. Bot should call `escalate_to_human(reason='caller_requested')` and within ~1s a Slack message should appear in the configured channel with:
   - Header: 🚨 Needs a human
   - Context: operator name · `•••<last4>` · convo id prefix · reason
   - Last ~10 transcript turns
   - Action buttons: Resume AI / Mark spam / Close / Show number

10. **Outbound bridge (Slack thread → SMS)** — reply in the Slack thread: `Hi, calling you back at 4pm`. Should arrive as SMS on the caller phone within ~1s. Subsequent replies in the same conversation are rate-limited to 1 per 8 seconds per CLAUDE.md §9.3.

11. **Inbound bridge (caller SMS → Slack thread)** — from the caller phone, text the Twilio number `ok thanks`. Should appear in the existing Slack thread as `📲 Caller (•••<last4>): ok thanks`. AI advance loop should **not** run (no bot reply in SMS).

12. **Handback** — in the Slack thread, click "Resume AI" or type `/bb back-to-bot`. Then text the Twilio number again. The AI advance loop should kick in (bot replies via SMS as if escalation never happened — with full transcript history including the agent's reply visible in `messages` table for context).

13. **Show-number audit** — open a fresh escalation (text "human" again), then run `/bb show-number` in the thread. Verify the ephemeral response reveals the full E.164, then check `/admin/operators/[id]` → Audit log tab → should see `escalation.show_number` row with your user_id as the actor.

### Most likely failure modes (in order)

1. **`SLACK_SIGNING_SECRET` typo** → Slack's `url_verification` would have failed at app creation, so this is unlikely. But if step 9 posts to Slack and then nothing bridges back, suspect this — every `/webhooks/slack/*` route runs through `SlackSignatureGuard` first.
2. **Bot not in channel** → `chat.postMessage` returns `not_in_channel` and the escalation falls through to email fallback (which is a no-op until Slice 10's Resend lands). Fix with `/invite @BookingBlues`.
3. **Migrations not applied** → `escalations` table missing → `openEscalation` throws → log line `escalate_to_human failed to open Slack escalation; conversation still flipped`. The conversation status flips to `escalated` regardless, but no Slack post happens.
4. **Redirect URL mismatch** → OAuth in step 7 fails with `?error=...` redirect. Slack rejects on the slightest difference; copy-paste from Railway, not from memory.

---

## Last session (2026-05-11)

Two big slices landed in one session — **Slice 15 (Internal admin dashboard)** and **Slice 7.5 (HITL via Slack)**.

### Slice 15 — Internal admin dashboard

Full scope from PROGRESS.md, including admin role storage decision.

- **ADR 0009** — `auth.users.app_metadata.role = 'admin'` (server-only-writable, no separate table, derived on JWT verify and surfaced as `AuthenticatedUser.isAdmin`).
- **Migration** `20260511000001_admin_role_helper.sql` — `admin_promote(text)` + `admin_demote(text)` SECURITY DEFINER functions for bootstrap.
- **Shared `AuditLogService`** in `apps/api/src/common/audit/` — every admin write logs IP + UA + reason.
- **Admin module** at `apps/api/src/modules/admin/` — read controller (cursor pagination on operators / conversations / appointments / payments / audit) + write controller (deactivate, cancel-subscription, release-twilio, refund-payment, force-end, impersonate via Supabase magic-link, promote/demote admins). Throttled at 30/min reads, 10/min writes.
- **Admin web UI** at `apps/web/app/(admin)/` — `/admin` overview, `/admin/operators` searchable table, `/admin/operators/[id]` tabbed dossier with action bar. Red banner ("Every action is logged"). Type-business-name confirms on deactivate. Reuses branded `ConfirmModal`.
- **Middleware** in `apps/web/middleware.ts` now gates `/admin/*` on `app_metadata.role`. Non-admins redirected to `/dashboard`. Layout double-checks server-side (defense in depth).

### Slice 7.5 — HITL via Slack

- **Migration** `20260511000002_hitl_slack.sql` — extends `webhook_source` with `'slack'`, adds `slack_connections` (encrypted bot token, AES-256-GCM with versioned key) + `escalations` (one-open-per-conversation partial unique index) + `messages.slack_message_ts`.
- **`apps/api/src/modules/slack/`** — `SlackApiClient` (chat.postMessage, oauth.v2.access, conversations.list), `SlackSignatureGuard` (v0 HMAC, 5-min replay window, raw-body buffer), `SlackConnectionsService` (encrypt/decrypt bot tokens, find by team/channel), `EscalationsService` (open / back-to-bot / resolve, bidirectional bridge with §9.3 8s rate limit per conversation), `SlackInstallController` (state HMAC binds operator_id), `SlackWebhooksController` (events / commands / interactivity).
- **`escalate_to_human` tool** now opens a Slack escalation (or falls back to email path with `fallback_email_sent_at` timestamp when Slack isn't configured or the post fails). Maps free-form `reason` text to the closed `escalation_reason` enum.
- **AdvanceService** short-circuits when conversation status is `escalated`. **TwilioSmsController** branches: status=`escalated` → `forwardCallerSmsToSlack`; otherwise → `advance.advance`.
- **`/bb` slash commands**: `resolve`, `close-spam`, `back-to-bot`, `show-number` (audit-logged), `book <ISO>` (placeholder until Slice 9-followup), `help`.
- **Action buttons** on the parent message: Resume AI, Mark spam, Close, Show number — all routed through interactivity webhook.
- **Slack app manifest** at `docs/slack-app-manifest.yaml`; full operator setup walkthrough at `docs/SLACK_SETUP.md`.
- **Log redactions** added: `*.bot_token`, `*.encrypted_bot_token`, `x-slack-signature` header.

### Tests + typecheck

- **63/63 unit tests pass** (up from 51 — added 12 across AdminGuard, JWT verifier isAdmin derivation, SlackSignatureGuard, and `escalate_to_human` reason normalization)
- API + web typecheck clean
- Integration tests under `apps/api/test/` still require local Supabase (`supabase start`) — not run in this session

### Docs updated this session

- `CLAUDE.md` §2, §3 (Slack added to diagram), §4 (HITL row), §9.3 (escalate_to_human is now Slack-bridged), §10 (admin + Slack endpoint blocks), §11 (new items 21–23 admin/audit/Slack), §12 (escalated is non-terminal)
- `docs/PROGRESS.md` — Slice 15 + 7.5 marked shipped with detailed completion notes
- `docs/adr/0009-admin-role-via-app-metadata.md` (new)
- `docs/SLACK_SETUP.md` + `docs/slack-app-manifest.yaml` (new)

### Status of dependencies (end of day)

- ✅ **Slack app created** in api.slack.com from `docs/slack-app-manifest.yaml`
- ✅ `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` set on Railway api service
- ✅ Railway build green
- ⏳ **Untested end to end** — verification flow at the top of this doc is the first thing tomorrow
- ⏳ **Migrations may or may not be applied to hosted Supabase** — Railway pre-deploy normally runs them; `supabase db push --linked` is the manual fallback
- ⏳ **First admin not yet promoted** — `select admin_promote('malhotra.vikas@gmail.com');` runs once in Supabase SQL editor before `/admin` works
- ⏳ **`pnpm gen:db` not yet re-run** for the new tables — `as any` casts in `admin-read.service.ts` (`countEscalationsOpen`) and across `slack-*.ts` are intentional placeholders to retire after gen

### Explicitly parked (post-verification follow-ups)

- **Channel picker UI on Slack install**: MVP uses the channel from the OAuth grant. Explicit picker deferred.
- **"Connect Slack" button on `/settings`**: today the install endpoint is curl-only. UX follow-up.
- **MRR / OpenAI cost MTD** in `/admin/metrics`: returns 0 placeholders until Stripe sync + token usage logging land (Slice 7-followup, Slice 11).
- **Slack `chat.postMessage` 1-msg/sec backoff**: 429 falls into catch + log; no retry loop yet.
- **`/bb book <ISO>` real implementation**: placeholder response only — Slice 9-followup.

---

## Tomorrow

### Top of mind

1. **Run the ⚡ verification flow at the top of this doc** — pre-flight (migrations + admin promote + gen:db), then admin dashboard smoke, then Slack install, then the full HITL bridge round-trip. ~12 min if nothing goes wrong.
2. **Resume the E2E walks that were parked from 2026-05-07**:
   - Service-area gating: in-area ZIP vs out-of-area (both real, both expected behaviors).
   - Booking completion (caller picks slot → Google Calendar event created).
   - Trial → paid (test card 4242 vs failure card 4000…9995).
3. **Replace the `as any` casts** after `pnpm gen:db` runs — small commit, search `eslint-disable-next-line @typescript-eslint/no-explicit-any` in `apps/api/src/modules/slack/` and `admin-read.service.ts`.
4. **Optional polish on the Slack flow** if it Just Works:
   - Add a "Connect Slack" button to `/settings` that calls `/v1/operators/me/slack/install` instead of needing curl
   - Surface escalations open count on the operator dashboard (not just admin)

### Feature queue (pick one)

- **Slice 7-followup** — pg-boss queue, async advance, token-usage logging, fee timeout (groundwork for MRR + OpenAI-cost-MTD metrics on the admin dashboard).
- **Slice 4-followup** — billing flow gaps: trial → paid test, cancellation flow, dedup, past-due degraded mode, trial reminder emails.
- **Slice 10** — Resend wrapper. Lets the email fallback path in `EscalationsService` actually deliver something (currently we just stamp `fallback_email_sent_at`).
- **Slice 11** — Sentry observability.
- **Hardening Phase 1** — original tomorrow plan from 2026-05-07; `docs/SECURITY_REVIEW.md` (auth/crypto/authz/OWASP/route-coverage).

### Blocked / waiting

- **Google Maps Geocoding API** (Phase C city/town centers) — still waiting on Google billing approval.

### Don't forget

- **Custom domain cutover** (Slice 13.5) — every Slack manifest URL in `docs/slack-app-manifest.yaml` is hard-coded to the Railway URL today. When the real domain lands, swap the manifest in the Slack dashboard too.
- **CLAUDE.md §8** still has the wrong migration filename example (`20260105_0001_create_operators.sql`); should be 14-digit timestamps. Fix when §8 is next touched.

---

## Repo state for the resumer

- Branch: `main`, in sync with `origin/main`. Working tree clean.
- Last 3 commits: `4619da0 HITL`, `b955847 Added HITL`, `60e5334 docs: end-of-day resume brief`.
- Slack app **created** in api.slack.com; `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` set on Railway api service. **Railway build is green.**
- Hosted Supabase migrations `20260511000001` + `20260511000002`: status uncertain — Railway pre-deploy normally runs `pnpm db:migrate`, but if you see "relation escalations does not exist" run `supabase db push --linked` manually.
- Active services: Railway api + web on auto-deploy from `main`. Local containers may still be up — `supabase stop` to tear down if you want a clean slate.

---

## Notes for the next session

- **The hosted Supabase doesn't yet have today's migrations.** Run `supabase db push --linked` first thing. If `pnpm gen:db` doesn't pick them up locally, restart local Supabase (`supabase stop && supabase start`) to apply.
- **The `as any` casts in `admin-read.service.ts` (countEscalationsOpen) and throughout `slack-*.ts`** are there because `escalations` and `slack_connections` aren't in db-types yet. After `pnpm gen:db`, replace those with proper typing in a small follow-up commit.
- **Twilio orphan number + duplicate Stripe subscriptions** from earlier QA are still on the accounts. Slice 4-followup tracks the dedup; today's UI fixes closed the *future* race.
