# BookingBlues — Progress Tracker

Running source of truth for what's built, what's in flight, and what's next.
**Updated after every slice that ships.** Survives any restart (lives in git).

When a section is wrong or stale, fix it in the same commit as the change.

---

## Status

- **Phase**: Foundations (scaffolding before features)
- **Last updated**: 2026-05-05
- **Active slice**: none — ready to start the next one
- **Production target**: EC2 (Slice 14). Railway is staging only (Slice 13).
- **HITL**: Slack-based (Slice 7.5).

---

## ✅ Shipped

### Skeleton (2026-05-05)
- Monorepo: pnpm 9 workspaces + Turborepo 2.1
- Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), `.npmrc`, `.nvmrc`, `.env.example` matching every var in CLAUDE.md §7
- `packages/config`: shared eslint flat configs (base/node/next), tsconfig presets, prettier preset
- `packages/shared`: empty stub for future zod schemas/types/constants
- `apps/api`: NestJS skeleton, `GET /v1/health`
- `apps/web`: Next.js 15 App Router placeholder landing page
- `supabase/config.toml`

### Foundations slice 1 (2026-05-05)
- **Env validation** — `apps/api/src/config/env.ts` with full §7 zod schema; production refuses to boot on missing required vars; `ENCRYPTION_KEY` accepts comma-separated `<v>:<hex>` for rotation. ConfigModule (global) exposes `Env` via `ENV_TOKEN`.
- **Logger** — nestjs-pino LoggerModule with §11.5 redaction paths (Twilio From/To/Body, `*.phone/*.email/*.refresh_token/*.access_token`, auth/Twilio/Stripe headers). JSON in prod, pretty-printed in dev. `/v1/health` excluded from request logs.
- **Error hierarchy** — `AppError` base + `Validation/Unauthorized/Forbidden/NotFound/Conflict/RateLimit/ExternalService/WebhookSignature` subclasses with stable `code`/`status`/`detail`/`extensions`.
- **RFC 7807 filter** — Global `ProblemDetailsFilter` emits `application/problem+json`; maps AppError, ZodError, HttpException, unknown throws (sanitized to 500 "unexpected error"). Warns for 4xx, errors for 5xx.
- **EncryptionService** — AES-256-GCM, wire format `v<N>:<iv_b64>:<tag_b64>:<ct_b64>`. Multi-key decrypt support for rotation; constructor tolerant of missing keys in dev (deferred error on actual use). 7/7 unit tests pass.
- **Bootstrap** — `dotenv` loads `.env.local` then `.env` at startup; production relies on platform-injected env.

### Slice 2 — Database foundations (2026-05-05)
- **Migration 0001 — init schema** — All §8 tables (`categories`, `operators`, `twilio_numbers`, `calendar_connections`, `conversations`, `messages`, `appointments`, `payments`, `webhook_events`, `audit_log`) with enums, FKs, CHECKs (E.164 phone format, fee≥0, `application_fee_cents ≤ amount_cents`, scheduled-range validity), indexes for dashboard queries, `set_updated_at` trigger function. `unique (source, event_id)` on `webhook_events` is the idempotency key.
- **Migration 0002 — RLS policies** — `auth_operator_id()` helper. `operators`: SELECT/UPDATE own; `appointments/conversations/messages/payments/calendar_connections`: SELECT-own only. `webhook_events/audit_log/twilio_numbers/categories`: RLS on, no policy → service-role only.
- **Migration 0003 — seed categories** — 5 launch categories per §16 (plumbing, hvac, electrical, roofing, garage_door). Vetting question stubs included; `system_prompt_template` is a placeholder, replaced in Slice 7.
- **`packages/db-types`** — workspace package with hand-written stub `Database` type covering rows we touch in Slice 2. Replaced wholesale by `pnpm gen:db` once Docker is up.
- **Root scripts** — `pnpm gen:db`, `pnpm db:migration:new`, `pnpm db:reset`.
- **`SupabaseService`** — service-role client (api-only). Constructor tolerant of missing creds (deferred-error pattern matching EncryptionService). `auth.persistSession` and `autoRefreshToken` disabled (server context).
- **`WebhookIdempotencyService`** — `record/markProcessed/markFailed` API. Detects PG `23505` to return `{status:'duplicate'}`. 4 unit tests with a mock Supabase client.
- **Test helpers** — `apps/api/test/helpers/tenants.ts` provisions N independent operator+user fixtures via the admin API and returns RLS-bound clients. `describeIfSupabase` skips tests when env vars are absent.
- **RLS regression scaffold** — `apps/api/test/rls.spec.ts` with 3 cases (own-row visible, other-tenant-invisible, webhook_events invisible). Currently skipped pending live Supabase; will run unattended in CI once Slice 12 wires up an ephemeral Supabase test project.
- **TS config split** — `tsconfig.json` (typecheck + tests, no rootDir), `tsconfig.build.json` (nest build, src/ only). nest-cli.json points to the build config so test files don't end up in `dist/`.
- **Status** — typecheck clean · 11 passed + 3 skipped tests · `nest build` succeeds · API boots and `/v1/health` responds.

### Slice 3 — Auth + operators (2026-05-06)
- **Local stack live** — Docker Desktop installed; `supabase start` boots the full local stack; `pnpm gen:db` generates real `Database` types from the live DB (replaces hand-written stub). Migrations renamed to 14-digit timestamps (`20260505000001_*` etc.) — Supabase CLI parses everything before the first `_` as version, so the original `<date>_<seq>_<name>` convention from CLAUDE.md §8 collapses three files to one version. CLAUDE.md §8 example needs updating in the next doc PR.
- **Jest env loading** — `apps/api/test/setup-env.ts` + `setupFiles` in jest config so `.env.local` is loaded; flips the RLS regression suite from skipped → live (no longer needs Slice 12 to activate locally).
- **Auth primitives** (`apps/api/src/common/auth/`) — `JwtVerifierService` delegates to `supabase.auth.getUser(token)` (handles both legacy HS256 and current ES256/JWKS — local Supabase issues ES256 now). `AuthGuard` Bearer extraction → `AuthedRequest.user`. `@CurrentUser()` param decorator. `@Global` `AuthModule` exports both.
- **`ZodBodyPipe`** (`common/pipes/`) — generic body validation; surfaces `ValidationError` with structured `issues` extension.
- **Operators module** (`modules/operators/`) — `OperatorsService` (getByUserId, update with FK→400 / unique→409 mapping, getOnboardingStatus). Controller: `GET/PATCH /v1/operators/me`, `GET /v1/operators/me/onboarding-status`. `UpdateOperatorSchema` zod DTO is `.strict()`, validates IANA timezone, business_hours `{day: [{start,end}]}`, refines `booking_fee_enabled ⇒ booking_fee_cents`. Service rejects the same fee-without-cents condition defensively for partial-patch sequences.
- **Me module** (`modules/me/`) — `GET /v1/me` returns `{id, email, created_at}` via `auth.admin.getUserById`. `PATCH /v1/me` updates email via `auth.admin.updateUserById` (Supabase sends confirmation).
- **Cross-tenant isolation suite** (`apps/api/test/cross-tenant.spec.ts`) — supertest against the test app under two separate user JWTs. 12 cases: own-row visible, B not leaked under A's token, 401 on missing/malformed token, PATCH updates only caller's row, strict zod rejects unknown fields, fee-without-cents → 400, unknown category slug → 400 (FK violation surfaced), known seed slug accepted, onboarding-status shape, `/v1/me` happy path + 401. Helper `setupTenants` now exposes the access token alongside the authed client.
- **AppModule wiring** — registers `AuthModule`, `MeModule`, `OperatorsModule`. Both feature modules import `SupabaseModule` per existing convention.
- **Status** — typecheck clean · 26/26 tests pass (was 11+3) · dev server smoke: `/v1/me` 401, `/v1/operators/me` 401, `/v1/health` 200.

---

## 🔄 In progress

_(none)_

---

## ⏭ Next up — recommended order

### Slice 4: Billing (BookingBlues SaaS subscription)
- [ ] Stripe SDK wrapper + platform webhook signature verification
- [ ] `POST /v1/billing/checkout-session` (subscription mode, 7-day trial, card required)
- [ ] `GET /v1/billing/portal-session`
- [ ] Platform webhook handler `/webhooks/stripe`: `checkout.session.completed`, `customer.subscription.{created,updated,deleted}`, `customer.subscription.trial_will_end`, `invoice.payment_{succeeded,failed}`
- [ ] Trial state machine: trialing → active / past_due / canceled

### Slice 5: Telephony
- [ ] Twilio SDK wrapper + signature verification
- [ ] `POST /v1/operators/me/twilio-number` (provisioning)
- [ ] `POST /webhooks/twilio/voice/:operatorId` (TwiML response)
- [ ] `POST /webhooks/twilio/sms/:operatorId` (signature verify, dedupe, enqueue advance job)
- [ ] Inbound `To` cross-check against operator's number (§11.10)
- [ ] Staging outbound-SMS allowlist (§11.12)

### Slice 6: Calendar
- [ ] Google OAuth flow (`POST /v1/operators/me/google/connect` → URL; `GET /v1/oauth/google/callback`)
- [ ] Refresh-token encryption at rest via EncryptionService
- [ ] `freebusy.query` helper, business-hours intersection, timezone handling
- [ ] `events.insert` with `sendUpdates=all`
- [ ] Token-revoked path (mark connection revoked, page operator)

### Slice 7: AI + conversations
- [ ] OpenAI client + structured tool dispatch
- [ ] System prompt assembly (static frame + operator block + category template)
- [ ] Tools: `check_availability`, `propose_slots`, `book_appointment`, `request_payment_link`, `mark_out_of_scope`, `mark_spam`, `escalate_to_human`
- [ ] `book_appointment` advisory lock on `(operator_id, slot_start)` (§17 race)
- [ ] Conversation state machine + pg-boss workers (24h abandon, 1h reminder, fee timeout)
- [ ] Caller-message delimiter wrapping; max-turn cap; output-token tracking

### Slice 7.5: Human-in-the-loop (HITL) via Slack
The bot escalates to a human operator/agent in Slack when (a) it cannot help the caller, or (b) the caller explicitly asks for a human. This is a higher-fidelity replacement for the `escalate_to_human` email path in §9.3 — emails turn into Slack threads with two-way bridging.
- [ ] Slack app: bot user, OAuth scopes (`chat:write`, `channels:history`, `app_mentions:read`, `commands`), event subscription URL
- [ ] Per-operator Slack workspace install flow (OAuth) + `slack_connections` table (encrypted bot token, team_id, default channel id)
- [ ] New `escalations` table: `id`, `operator_id`, `conversation_id`, `caller_phone_e164`, `slack_channel_id`, `slack_thread_ts`, `reason ('bot_stuck'|'caller_requested')`, `status ('open'|'resolved'|'abandoned')`, `resolved_by_user_id`, `created_at`, `resolved_at`
- [ ] Bot tool `escalate_to_slack({ reason })` — replaces or augments `escalate_to_human`
- [ ] On escalation: post a parent message in the operator's configured Slack channel with caller phone (last 4), conversation summary, recent transcript; capture `thread_ts`
- [ ] Agent replies in the Slack thread → bridge service forwards as SMS to caller (rate-limited per §9.3)
- [ ] Caller SMS replies → mirrored as new messages in the same Slack thread (with PII redaction in non-prod)
- [ ] Slack slash commands: `/bb resolve`, `/bb book <ISO datetime>`, `/bb close-spam` to take terminal actions on the conversation from Slack
- [ ] Slack webhook signature verification (per CLAUDE.md §11.1 pattern); idempotency via `webhook_events` with `source='slack'` (requires migration adding `'slack'` to `webhook_source` enum)
- [ ] Cap: only one open escalation per conversation; second trigger reuses existing thread
- [ ] Update CLAUDE.md §3 (architecture diagram), §4 (tech stack adds Slack), §9.3 (tool list), §10 (webhooks endpoint), §11 (signature validation, allowlist channels) when this slice lands

### Slice 8: Payments (Stripe Connect)
- [ ] `POST /v1/operators/me/connect/onboarding-link`
- [ ] Stripe SDK helper requiring `stripeAccount` (typed wall against missing header)
- [ ] Direct-charges Checkout Session creation on connected account with `application_fee_amount`
- [ ] Connect webhook handler `/webhooks/stripe/connect` (separate signing secret)
- [ ] Refund flow with `refund_application_fee: true`
- [ ] Eligibility gate (subscription_status, charges_enabled, payouts_enabled, fee_enabled)

### Slice 9: Web app
- [ ] Supabase auth pages (login, signup)
- [ ] Onboarding wizard (category, phone verify, Twilio number, Google connect, fee config, carrier instructions)
- [ ] Dashboard (conversations list, appointments list, monthly metrics)
- [ ] Settings page (hours, fee on/off, calendar disconnect, cancel subscription)
- [ ] Marketing pages (`/`, `/pricing`, `/faq`)

### Slice 10: Notifications + polish
- [ ] Resend wrapper, transactional email templates
- [ ] SMS templates module (no inline strings — §9.6)
- [ ] 1-hour reminder cron via pg-boss
- [ ] Smoke checklist `apps/api/test/SMOKE.md`

### Slice 11: Observability — Sentry
- [ ] Sentry SDK init in `apps/api` with PII scrubbing config matching §11.5 redact paths
- [ ] Sentry SDK init in `apps/web`
- [ ] Source maps upload from CI (api + web)
- [ ] Release tagging via git SHA; environment tag (`development`/`staging`/`production`)
- [ ] User context: attach `operator_id` (never raw email/phone) to error events
- [ ] Tracing/performance: capture API request transactions; sample rate per env
- [ ] Alert routing destination (Slack channel? Email? PagerDuty?) — TBD
- [ ] Verify redactions: integration test that confirms a known PII payload is scrubbed end-to-end

### Slice 12: CI gates + security scanning
Triggered on every PR and push to `main`. Blocks merge on failures.
- [ ] GitHub Actions workflow: install, typecheck, lint, test, build (matrix per app)
- [ ] **Secret scanning** — `gitleaks` pre-commit hook + CI workflow (per §11.8)
- [ ] **Dependency vulnerability scanning** — `pnpm audit --prod` gate; block merge on high+ severity (per §11.19)
- [ ] **Dependabot** — npm ecosystem + GitHub Actions ecosystem; weekly cadence
- [ ] **Static analysis** — CodeQL (or Semgrep) workflow
- [ ] **Lockfile + container scan** — Trivy on the API Docker image
- [ ] **License compliance** — `license-checker` allowlist
- [ ] **Branch protection** — require passing checks; require signed commits; no force-push to `main`
- [ ] **RLS regression suite** runs in CI against an ephemeral Supabase test project (per §11.18)
- [ ] **Cross-tenant isolation suite** runs in CI on every PR (per §11.11)

### Slice 13: Railway staging deployment
- [ ] Railway services (api, web, worker)
- [ ] Pre-deploy migration command
- [ ] Staging Supabase + Stripe test mode + Twilio subaccount
- [ ] Domain + HSTS preload (§11.20)
- [ ] End-to-end smoke run on staging before any production traffic

### Slice 14: EC2 production deployment (go-live)
Migration target when we're ready to leave Railway and serve real traffic.
- [ ] Architecture decision (record in `docs/adr/`): instance sizing, AZ/region, AMI strategy
- [ ] Infrastructure as Code — Terraform (or CDK / Pulumi — decide)
- [ ] VPC + public/private subnets, security groups, IAM roles, Secrets Manager
- [ ] Application Load Balancer + TLS via ACM; HSTS preload (§11.20)
- [ ] Auto Scaling Group for `api`; separate ASG for queue workers
- [ ] Database path: continue Supabase via VPC peering OR migrate to RDS — decide
- [ ] CloudWatch logs + metrics (or ship structured logs to Sentry/Datadog)
- [ ] Deployment pipeline: CodeDeploy or Actions-driven blue/green; immutable releases
- [ ] Backup/restore procedure tested end-to-end
- [ ] Cutover plan from Railway → EC2: DNS, data, webhook URL updates for Twilio/Stripe/Google, rollback path
- [ ] Runbooks: deploys, rollbacks, incident response, key rotation
- [ ] Update CLAUDE.md §4 and §14 to reflect EC2 as production target

---

## 🚫 Out of scope (post-MVP) — per CLAUDE.md §16

Multi-user/teams per Operator · Operator-editable AI prompts · Voice AI (call handling) · Mobile app · Analytics beyond simple counts · Number porting · White-labeling · Multiple calendars per Operator · Outbound campaigns

---

## 📝 Decisions log

Record any deviation from CLAUDE.md here, then update CLAUDE.md in the same PR.

- **2026-05-05** — `EncryptionService` constructor is tolerant of zero keys in dev (defers `crypto.no_keys` error to first encrypt/decrypt). Production env validation still requires `ENCRYPTION_KEY`. Reason: lets the API boot for non-crypto work in dev (health checks, schema introspection) before anyone has filled in `.env.local`.
- **2026-05-05** — Production target is **EC2** (Slice 14), not Railway. Railway remains the staging target (Slice 13). CLAUDE.md §4 and §14 currently say "Railway" only — they will be updated in the PR that lands Slice 14, not before. Reason: user prefers AWS control plane for go-live; Railway is faster for iteration during build-out.
- **2026-05-05** — HITL via **Slack** added as Slice 7.5. Replaces (or augments) the email-only `escalate_to_human` path described in CLAUDE.md §9.3. Triggered when the bot can't help OR the caller asks for a human. Two-way bridging (Slack thread ↔ SMS) so the operator/agent can take over without leaving Slack. Reason: contractors live in Slack/messaging more than email — faster takeover and resolution. CLAUDE.md §3, §4, §9.3, §10, §11 will be updated in the PR that lands this slice.
- **2026-05-05** — `packages/db-types/src/database.types.ts` is hand-written for Slice 2 (only covers `operators` and `webhook_events`). Replaced wholesale by `pnpm gen:db` output the first time it's run (requires Docker + `supabase start`). Reason: Docker isn't installed on the dev machine yet; this lets us ship typed code now and swap in autogen later without code changes.
- **2026-05-05** — `calendar_connections.status` enum (`active`/`revoked`) added beyond what CLAUDE.md §8 lists. Reason: §9.4 requires marking connections revoked on Google 401, and a single-flag column models that more cleanly than a boolean. Will be reflected in CLAUDE.md §8 the next time §8 is touched.
- **2026-05-06** — Migration filename format changed from `<YYYYMMDD>_<NNNN>_<name>.sql` (per CLAUDE.md §8 example) to `<YYYYMMDDHHMMSS>_<name>.sql` (14-digit timestamp). Reason: the Supabase CLI parses everything before the first `_` as the migration version, so all `20260505_NNNN_*` files collapsed to version `20260505` and the second one duplicate-keyed `supabase_migrations.schema_migrations`. CLAUDE.md §8 example is misleading — should be updated in the next doc PR.
- **2026-05-06** — User JWT verification uses `supabase.auth.getUser(token)` (one HTTP call to the Supabase auth API) rather than local HS256 verification with `SUPABASE_JWT_SECRET`. Reason: local Supabase issues asymmetric ES256 tokens with a JWKS endpoint; HS256 with the shared secret no longer works. The remote call is correct in all configs (HS256 / ES256, current / rotated keys). Trade-off: ~5–50ms latency per authenticated request. Swap to local JWKS verification (`jose` library) if/when latency matters; tracked as a follow-up for Slice 11 (observability) where we'll already be measuring request-path performance.
