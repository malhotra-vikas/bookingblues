# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

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

### What's still missing / explicitly parked

- **Slack app itself**: the user is going to create the BookingBlues app in api.slack.com using `docs/slack-app-manifest.yaml`. Until that happens + `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_SIGNING_SECRET` are set in Railway, the install / webhook routes will 500 with `slack.no_credentials`. Code is wired and ready.
- **First admin**: until someone runs `select admin_promote('your-email@bb.com');` in Supabase SQL editor, `/admin` redirects everyone to `/dashboard`.
- **Channel picker UI on Slack install**: MVP uses the channel from the OAuth grant. Explicit picker deferred.
- **MRR / OpenAI cost MTD** in `/admin/metrics`: returns 0 placeholders until Stripe sync + token usage logging land (Slice 7-followup, Slice 11).
- **Slack 1-msg/sec backoff**: 429 falls into catch + log; no retry loop yet.
- **`/bb book <ISO>` real implementation**: placeholder response only.

---

## Tomorrow

### Top of mind

1. **Create the Slack app** via `docs/slack-app-manifest.yaml` → paste 3 env vars into Railway → smoke the install flow on a test operator.
2. **Promote first admin** in Supabase SQL editor: `select admin_promote('malhotra.vikas@gmail.com');`
3. **Apply the two new migrations to hosted** Supabase: `supabase db push --linked` (project `ozsckjjlydtujbhajjla`).
4. **Run `pnpm gen:db`** so `escalations` + `slack_connections` types land in `packages/db-types/` (removes the `as any` casts in `admin-read.service.ts` and `slack-*.ts`).
5. **Resume the E2E walks** that were parked yesterday:
   - Service-area gating: in-area ZIP vs out-of-area (both real, both expected behaviors).
   - Booking completion (caller picks slot → Google Calendar event created).
   - Trial → paid (test card 4242 vs failure card 4000…9995).
   - **New for today**: trigger an escalation, reply in Slack thread, see the SMS land, then `/bb back-to-bot` and see the next caller message go back to the AI loop.

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

- Branch: `main`. **Not yet committed** — 2 slices' worth of changes are in the working tree. Commit before context drift.
- Working tree includes: 2 new SQL migrations, ADR 0009, `apps/api/src/modules/admin/` (5 files), `apps/api/src/modules/slack/` (6 files), `apps/api/src/common/audit/` (2 files), `apps/web/app/(admin)/` (4 files), `apps/web/components/admin/` (2 files), middleware.ts gate, AuthModule + AppModule + AiModule + WebhooksModule wiring, tool-handlers + advance + sms-webhook integration, prompt + log-redact updates, CLAUDE.md + PROGRESS.md + Slack docs.
- Active services: Local Supabase containers (`supabase stop` to tear down). Railway on auto-deploy from `main` — first push will fail to boot until the two new env-var triples (Slack) are set, but since they're optional in dev/staging, the API still boots. Migrations will run on next deploy.

---

## Notes for the next session

- **The hosted Supabase doesn't yet have today's migrations.** Run `supabase db push --linked` first thing. If `pnpm gen:db` doesn't pick them up locally, restart local Supabase (`supabase stop && supabase start`) to apply.
- **The `as any` casts in `admin-read.service.ts` (countEscalationsOpen) and throughout `slack-*.ts`** are there because `escalations` and `slack_connections` aren't in db-types yet. After `pnpm gen:db`, replace those with proper typing in a small follow-up commit.
- **Twilio orphan number + duplicate Stripe subscriptions** from earlier QA are still on the accounts. Slice 4-followup tracks the dedup; today's UI fixes closed the *future* race.
