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

---

## 🔄 In progress

_(none)_

---

## ⏭ Next up — recommended order

### Slice 2: Database foundations
- [ ] First Supabase migration: §8 core schema (`operators`, `categories`, `twilio_numbers`, `calendar_connections`, `conversations`, `messages`, `appointments`, `payments`, `webhook_events`, `audit_log`)
- [ ] RLS policies (default deny; operator-scoped reads via `auth.uid()`; service-role-only writes for sensitive tables)
- [ ] Seed `categories` lookup
- [ ] `pnpm gen:db` script + `packages/db-types` package
- [ ] Supabase service-role client wrapper (server-only, never imported by web)
- [ ] Webhook idempotency helper using `webhook_events (source, event_id)` unique key
- [ ] RLS regression test scaffold (CI)
- [ ] Cross-tenant isolation test helper

### Slice 3: Auth + operators
- [ ] Supabase JWT verification guard
- [ ] `GET /v1/me`, `PATCH /v1/me`
- [ ] `operators` module (profile read/write; settings: hours, timezone, fee config)
- [ ] `GET/PATCH /v1/operators/me`, `GET /v1/operators/me/onboarding-status`
- [ ] Cross-tenant isolation tests for every operator-scoped controller

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
