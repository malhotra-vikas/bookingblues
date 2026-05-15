# BookingBlues — Progress Tracker

Running source of truth for what's built, what's in flight, and what's next.
**Updated after every slice that ships.** Survives any restart (lives in git).

When a section is wrong or stale, fix it in the same commit as the change.

---

## Status

- **Phase**: Foundations (scaffolding before features)
- **Last updated**: 2026-05-11
- **Active slice**: none — Slice 15 + 7.5 just landed; pending E2E smoke + Slack-app creation
- **Production target**: EC2 (Slice 14). Railway is staging only (Slice 13).
- **HITL**: Slack-based (Slice 7.5) — **shipped** (code, manifest, docs; needs the Slack app created in api.slack.com to function end-to-end).

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

### Slice 4 — Billing (BookingBlues SaaS subscription) (2026-05-06)
- **Stripe SDK + raw-body wiring** — `apps/api/src/common/stripe/{stripe.module,stripe.service}.ts`. `StripeService` is constructor-tolerant (deferred error like Supabase/Encryption). Exposes `client()`, `connect(stripeAccountId)` (Slice 8), `verifyPlatformWebhook`, `verifyConnectWebhook`. `NestFactory.create({ rawBody: true })` so `/webhooks/*` handlers can read `req.rawBody` for signature verification. `setGlobalPrefix('v1', { exclude: [{ path: 'webhooks/(.*)', method: ALL }] })` keeps webhooks unprefixed per CLAUDE.md §10.
- **Billing module** (`modules/billing/`) — `BillingService` lazily creates the operator row on first checkout (defaults `business_name` to provided name, then email local-part, then "New Business") and lazily creates the Stripe customer (stamps `stripe_customer_id` back on the operator). `createCheckoutSession` builds a subscription-mode session per CLAUDE.md §9.1: `client_reference_id = operator.id`, `payment_method_collection = 'always'`, `subscription_data.trial_period_days = TRIAL_DAYS`, `subscription_data.trial_settings.end_behavior.missing_payment_method = 'cancel'`. `createPortalSession` requires an existing `stripe_customer_id` (409 otherwise).
- **Endpoints** — `POST /v1/billing/checkout-session` (`{plan: 'starter'|'pro', business_name?}`) → `{url}`. `GET /v1/billing/portal-session` → `{url}`. Both Bearer-guarded.
- **Platform Stripe webhook** — `POST /webhooks/stripe` (`StripePlatformController`). Verifies `stripe-signature` with `STRIPE_WEBHOOK_SECRET`, records via `WebhookIdempotencyService` (`unique (source, event_id)` dedupes retries), dispatches via pure `dispatchPlatformEvent`. Handlers: `checkout.session.completed` (links `stripe_subscription_id` to operator by `client_reference_id`); `customer.subscription.{created,updated}` (looks up operator by `stripe_customer_id` and writes `subscription_status` + `trial_ends_at`); `customer.subscription.deleted` (status → `canceled`); `customer.subscription.trial_will_end` (TODO email — wired in Slice 10 Resend); `invoice.payment_{succeeded,failed}` (no-op; status arrives via subscription.updated).
- **Stripe → DB enum mapping** — `mapSubscriptionStatus` covers all 8 Stripe states; `unpaid → past_due` and `paused → canceled` (we don't model paused yet).
- **Tests** — 8 parameterised unit cases for `mapSubscriptionStatus` + 5 integration cases against real Supabase: unsigned → 400, bad signature → 400, valid `subscription.created` → operator status `trialing` and `trial_end` populated, idempotent re-delivery preserves first-write values (different sub id in second payload is ignored), unrelated tenants untouched. Total **39/39 pass** (was 26).
- **Smoke** — `POST /v1/billing/checkout-session` 401, `GET /v1/billing/portal-session` 401, `POST /webhooks/stripe` 400 (no sig), `/v1/health` 200.

### Slice 5 — Telephony (2026-05-06)
- **Twilio SDK wrapper** (`apps/api/src/common/twilio/{twilio.module,twilio.service}.ts`) — constructor-tolerant in dev. `client()`, `validateSignature({signatureHeader, fullUrl, formParams})` (delegates to Twilio's HMAC-SHA1), `sendSms({from, to, body})` with §11.12 outbound allowlist: in non-prod, `to` MUST be in `OUTBOUND_SMS_ALLOWLIST` (comma-separated E.164) — unset = block-all (fail-safe). Production ignores the allowlist.
- **Env additions** — `OUTBOUND_SMS_ALLOWLIST` zod-optional. Mirrored in `.env.example`.
- **Number provisioning** (`modules/telephony/`) — `POST /v1/operators/me/twilio-number {area_code?}` searches local US numbers (optionally area-code-filtered), purchases via `incomingPhoneNumbers.create` with voice/sms webhook URLs pointing at `${API_URL}/webhooks/twilio/{voice,sms}/${operatorId}`, inserts into `twilio_numbers` (status='assigned'), links onto `operators.twilio_number_{e164,sid}`. 409 if operator already has a number; logs loudly + 500 if Twilio purchase succeeded but DB writes failed (manual reconciliation expected).
- **Conversations module** (`modules/conversations/`) — `getOrCreate(operatorId, callerPhone)` returns the most recent non-terminal conversation or creates a new `awaiting_bot` row. `appendMessage({conversationId, role, body, twilioMessageSid?})` inserts and bumps `last_message_at`. Slice 7 owns the full state machine (CLAUDE.md §12).
- **Voice webhook** (`POST /webhooks/twilio/voice/:operatorId`) — verifies `x-twilio-signature` against `${API_URL}${req.originalUrl}`, resolves operator + verifies `To == operator.twilio_number_e164` (§11.10), records via `WebhookIdempotencyService` keyed on `CallSid` (source='twilio'), inline side-effect: `conversations.getOrCreate` + outbound opening SMS via `twilio.sendSms` + `appendMessage(role='bot', sid)`. Always returns the §9.2 TwiML greeting (escapes XML special chars in business name); side-effect failure is logged but the caller still gets the greeting (Slice 7 worker can retry).
- **SMS webhook** (`POST /webhooks/twilio/sms/:operatorId`) — same signature/operator/To checks. Records keyed on `MessageSid`, persists inbound `role='caller'` message via `appendMessage`. Returns empty `<Response/>`. Slice 7 will enqueue the AI advance job here.
- **Tests** — 3 unit cases for `escapeXml` + 5 integration cases for the SMS webhook (no signature → 400, tampered signature → 400, To mismatch → 403, valid signed request persists message + creates conversation, replay of same MessageSid is a no-op). Helper `signTwilioRequest` computes the canonical Twilio HMAC-SHA1 over `url + sortedKey+value...`. Total **47/47 pass** (was 39).
- **Smoke** — `POST /v1/operators/me/twilio-number` 401 (no auth), webhook 500 with no Twilio creds in dev `.env.local` (by design — config error is loud rather than silent), `/v1/health` 200.

### Slice 6 — Calendar (2026-05-06)
- **`google-auth-library`** added (lighter than full `googleapis`; we hit `freeBusy` and `events.insert` directly via `fetch`).
- **State CSRF token** (`modules/calendar/calendar-state.ts`) — `<userId>.<expiry>.<nonce>.<hmac_sha256>` signed with `SUPABASE_JWT_SECRET`. 10-min TTL, timing-safe equality, rejects tamper/expiry/wrong-secret/malformed. 5 unit tests cover all branches.
- **`GoogleOAuthService`** — `authUrl(state)` (scopes `calendar.events`, `calendar.readonly`, `userinfo.email`; `access_type=offline`, `prompt=consent` to guarantee a refresh token on every connect). `exchangeCode(code)` returns `{refreshToken, accessToken, expiresAt, scopes, email}`; throws `google.no_refresh_token` if Google omits it. `refreshAccessToken(refreshToken)` for token refresh. Tolerant constructor (deferred error like Stripe/Twilio).
- **`CalendarService`** — `getConnection`, `upsertConnection` (encrypts refresh_token via `EncryptionService`, stamps `operators.google_calendar_id='primary'` + `connected_at`), `disconnect` (overwrites refresh_token with sentinel + status='revoked' + clears operator pointer), `markRevoked`, `getFreshAccessToken` (returns cached if >60s remaining; otherwise refreshes and updates cache; on `invalid_grant` calls `markRevoked` per CLAUDE.md §9.4), `freeBusy({operatorId, windowStart, windowEnd, timeZone})` (proxy to Google's REST API; 401 → markRevoked + ExternalServiceError), `insertEvent({summary, start, end, timeZone, attendeeEmails})` (with `sendUpdates=all` per §9.4).
- **Endpoints** — `POST /v1/operators/me/google/connect` → `{url}` (Bearer-guarded). `POST /v1/operators/me/google/disconnect` → `{ok:true}`. `GET /webhooks/google/oauth/callback?code&state[&error]` — verifies state, exchanges code, upserts connection, redirects to `${APP_URL}/onboarding/calendar?(connected=google|error=…)`. Webhook path is unprefixed per CLAUDE.md §10.
- **Smoke** — connect/disconnect 401 unauth, callback with no params returns 302 → `…/onboarding/calendar?error=missing_code_or_state`.
- **Status** — typecheck clean · **52/52 tests pass** (was 47).

### Slice 7 — AI + conversations (2026-05-06)
- **OpenAI SDK** (`apps/api/src/common/openai/`) — deferred-error pattern; model `gpt-4.1` per CLAUDE.md §9.3. `OpenAIService.client_()` exposes the underlying client.
- **Prompt assembly** (`modules/ai/prompts.ts`) — static frame (rules, persona, refusal policy, prompt-injection defense per §11.16) + per-operator block (business name, category, timezone, now, fee policy) + per-category template from `categories.system_prompt_template`. `wrapCallerMessage(body)` wraps caller text in `<<CALLER_MESSAGE>>...<<END>>` so the model knows it is untrusted data.
- **Tool definitions** (`modules/ai/tool-definitions.ts`) — JSON-schema definitions for the 7 tools per §9.3 (`check_availability`, `propose_slots`, `book_appointment`, `request_payment_link`, `mark_out_of_scope`, `mark_spam`, `escalate_to_human`) plus zod schemas for runtime arg validation. ISO 8601 with offset enforced for all datetime args.
- **Tool handlers** (`modules/ai/tool-handlers.ts`) — implementation for each tool. `book_appointment` inserts into appointments, then calls `calendar.insertEvent({...sendUpdates:'all'...})`; on calendar failure the appointment row is rolled back to `cancelled`. `request_payment_link` is a stub returning `fee_collection_unavailable` (Slice 8 wires real Stripe Connect Direct Charges Checkout). `mark_out_of_scope`/`escalate_to_human` send a polite handoff SMS; `mark_spam` is silent (`silentTerminate: true`).
- **Slot dedup** (`supabase/migrations/20260506000001_slot_dedup_unique.sql`) — partial unique index `(operator_id, scheduled_for_start) where status in ('proposed','confirmed')`. CLAUDE.md §17 specifies a Postgres advisory lock; the partial unique index gives the same race-protection with simpler semantics — concurrent winners insert, losers see 23505 which the bot translates into "that slot was just taken — pick another."
- **AdvanceService** (`modules/ai/advance.service.ts`) — orchestrates the OpenAI loop. Loads operator, category, conversation history (caller↔assistant text turns only — tool calls don't persist across advances). Caller-turn cap (`MAX_CALLER_TURNS = 20`, §9.3) forces `escalate_to_human` when reached. Inner loop iterates up to `MAX_TOOL_ITERATIONS = 5` per advance. Terminal tool result transitions conversation to `completed`/`escalated` with outcome; non-terminal sets `awaiting_caller`. Outbound SMS sent via `TwilioService.sendSms` (which itself enforces §11.12 allowlist in non-prod).
- **SMS webhook integration** — `TwilioSmsController` now: 1) records inbound + acks idempotency (this part fails the webhook → Twilio retry), 2) best-effort calls `advance.advance` in a try/catch (this part swallows errors with a log so a missing `OPENAI_API_KEY` in dev or transient OpenAI 5xx don't trigger Twilio retry-loops). Eventually-consistent: failed advances need manual replay until pg-boss queue lands.
- **Tests** — 5 prompt-assembly cases + 5 tool-arg validation cases. **62/62 pass** (was 52).
- **Status** — typecheck clean. Dev server at `:3001` healthy.

### Slice 8 — Payments (Stripe Connect Direct Charges) (2026-05-06)
- **Pricing** (`modules/payments/pricing.ts`) — `computeApplicationFee({amountCents, takeRateBps, minPlatformFeeCents})` returns `{applicationFeeCents, clampedToCap, capCents}`. Caps at `amount - (amount * 0.029 + 30)` (Stripe US standard processing) — Stripe rejects DC charges where `application_fee_amount > amount - processing_fee` (CLAUDE.md §9.5). 5 unit tests cover floor/percent dominance, tiny-amount clamp, zero/negative, custom take rate.
- **Connect onboarding** — `POST /v1/operators/me/connect/onboarding-link` (Bearer-guarded). Creates a Stripe Express account on first call (`type='express'`, `country='US'`, requested capabilities `card_payments` + `transfers`, metadata links operator + user), stamps `operators.stripe_connect_account_id`, then issues an `accountLinks.create` for `account_onboarding`. Returns `{url}` for the web app to redirect into.
- **`PaymentsService.ensureFeeEligible(operatorId)`** enforces all four CLAUDE.md §9.5 gates (fee enabled + cents set, subscription `trialing`/`active`, `stripe_connect_account_id` present, both `charges_enabled` and `payouts_enabled` true). Throws `ValidationError` with the specific failed gate.
- **`PaymentsService.createBookingFeeCheckout({operatorId, appointmentId})`** — creates a Direct Charges Checkout Session **on the connected account** (`{stripeAccount}` second arg) with `payment_intent_data.application_fee_amount` from the pricing service. Inserts a `payments` row in `pending` keyed on the PI id, stamps `appointments.fee_payment_intent_id`/`fee_checkout_session_id`/`fee_status='pending'`. 23505 on the unique PI id surfaces as 409.
- **`PaymentsService.refundBookingFee(paymentId, reason?)`** — `refunds.create({payment_intent, refund_application_fee:true, reverse_transfer:false}, {stripeAccount})` per §9.5. Updates payment + appointment to `refunded`. Validates payment is currently `succeeded`.
- **Connect webhook** (`/webhooks/stripe/connect`) — verifies via separate `STRIPE_CONNECT_WEBHOOK_SECRET`, requires `event.account` (envelope's connected account id), idempotent via `webhook_events` with `source='stripe_connect'`. Handlers cross-reference `event.account` against `payments.stripe_connected_account_id` / `operators.stripe_connect_account_id` per §11.13 — mismatch is rejected. Dispatches: `account.updated` (mirrors `charges_enabled`/`payouts_enabled` to the operator row), `payment_intent.succeeded` (flips payment + appointment to `succeeded`/`paid`), `charge.refunded` (handles full + partial refunds).
- **AI tool wiring** — `request_payment_link` is no longer a stub; calls `PaymentsService.createBookingFeeCheckout` and returns `{url, payment_id}` to the model PLUS attaches `outboundMessage` so the SMS goes out even if the model paraphrases. On eligibility failure (any gate), returns `{error:'fee_unavailable', message}` so the model continues without a fee.
- **Smoke** — `POST /v1/operators/me/connect/onboarding-link` 401 unauth, `POST /webhooks/stripe/connect` 400 (no sig).
- **Status** — typecheck clean · **67/67 tests pass** (was 62).

### Slice 9 — Web app (2026-05-06)
- **Foundation** — Tailwind 3.4 set up (`tailwind.config.ts`, `postcss.config.js`, `app/globals.css`, custom palette `ink/paper/muted/accent`). `lib/env.ts` zod-validates `NEXT_PUBLIC_*` at module load. `@supabase/ssr` browser + server helpers. `lib/api.ts` exposes `api()` (raw) and `apiAsUser()` (resolves session via server client and attaches Bearer). `apps/web/.env.local` lives separately from the monorepo root because Next.js only auto-discovers env in the app dir.
- **Auth** — `middleware.ts` runs `supabase.auth.getUser()` (which refreshes expired access tokens, writing fresh cookies on the response), redirects unauth → `/login?next=…`, and bounces signed-in users away from `/login`/`/signup`. `AuthForm` (client component) does email+password sign-in/sign-up via `@supabase/ssr` browser client. `SignOutButton` clears the session and refreshes the route tree.
- **Dashboard layout + page** — `(dashboard)/` group with `Nav` (current email + sign-out + section links). `/dashboard` server-renders 4 KPI cards (conversations, booked, appointments, fee revenue this month), recent conversations table, and upcoming appointments table — phone numbers masked to last 4 (CLAUDE.md §11.5). If the operator row doesn't exist yet, redirects the user to onboarding instead.
- **Onboarding wizard** — `/onboarding` 6-step page (`Wizard` client component): subscribe (`/v1/billing/checkout-session`), category (`PATCH /v1/operators/me`), Twilio number (`POST /v1/operators/me/twilio-number`), Google Calendar (`POST /v1/operators/me/google/connect` → redirect), Stripe Connect (`POST /v1/operators/me/connect/onboarding-link` → redirect), booking fee (`PATCH /v1/operators/me`). Step status derived live from operator row.
- **Settings** — `/settings` covers business name, timezone, fee on/off + amount, Google disconnect, billing portal launch (`GET /v1/billing/portal-session`). Subscription status surfaced.
- **Marketing** — `(marketing)/` group with shared header (Sign in / Get started CTAs). `/` hero + 3-feature pitch, `/pricing` Starter $49 / Pro $149, `/faq` 5 entries.
- **API additions** — `DashboardModule` adds `GET /v1/dashboard/metrics` (this-month counts derived per-tenant), `GET /v1/conversations` (last 50, last_message_at desc), `GET /v1/appointments` (last 50 by scheduled_for_start). All Bearer-guarded; 404 when no operator yet.
- **Smoke** — `/`, `/pricing`, `/faq`, `/login`, `/signup` 200. `/dashboard`, `/settings`, `/onboarding` 307 → `/login?next=…`. `/v1/dashboard/metrics`, `/v1/conversations`, `/v1/appointments` 401 unauth. Tests still **67/67**.

### UX-followup: loading states across the rest of the app
Onboarding wizard now disables every async button + shows a "Saving…" /
"Opening checkout…" label while the request is in flight (real bug:
double-click on Twilio provisioning created an orphan number in QA).
The same treatment is needed everywhere else a button fires a network
call:

- [ ] `SettingsPanel` — Save profile, Disconnect Google, Open billing portal
  (currently has a single `busy` string state — works but not per-action)
- [ ] `TrialBanner` — Fix payment method (portal launch) + End-trial-now (modal
  has its own busy already; double-check)
- [ ] `AuthForm` — already has `busy` ✓
- [ ] `SignOutButton` — already has `busy` ✓
- [ ] `ConfirmModal` — already has `busy` ✓
- [ ] All future client buttons should follow the same pattern: per-key busy
  set + disabled prop + "Working…" label, OR adopt a shared `useAsyncAction(key, fn)`
  hook to avoid repetition

### Slice 9-followup
- [ ] Dashboard `/conversations/:id` view (full transcript)
- [ ] Appointments `PATCH /v1/appointments/:id` + cancel UI
- [ ] Business hours editor (per-day intervals; current settings page only shows timezone)
- [ ] Carrier-specific conditional-forwarding instructions in onboarding step 3 (CLAUDE.md §17 carriers vary)
- [ ] Marketing pages design polish, real copy, OG images

### Hardening — comprehensive pre-launch pass (multi-day, run before Slice 13/14 cutover)
Goal: everything non-product-feature — security, observability, CI/CD discipline, auto-scanning, secret hygiene, ops runbooks. Each phase has a checkpoint; surface findings as we go, don't batch a single report.

**Phase 0 — Discovery (✅ 2026-05-06)** — see `docs/HARDENING_PHASE_0_FINDINGS.md`
- [x] Surfaces, CI, secrets inventoried (35 env vars, 2 deployables)
- [x] `pnpm audit` baseline: **35 vulns · 2 critical · 10 high** — both criticals are `next@15.0.0` (middleware-bypass + RCE), patched in 15.2.3
- [x] Git-history secret sweep clean (3 commits, no remote, only false-positive on empty `.env.example` placeholder)
- [ ] Production header `curl -sI` deferred until Railway staging is up (Slice 13)
- **Open questions for human** at end of findings doc — answer before Phase 1

**Phase 1 — Code-level security review (~½ day)** → `docs/SECURITY_REVIEW.md`
- [ ] Severity-ranked findings table (file:line, status)
- [ ] Auth review: password hashing/JWT signing/refresh-token rotation/session revocation/login timing/audit-log coverage
- [ ] Crypto review: AES-256-GCM IV+tag handling (we already have `EncryptionService`), key derivation, decrypt failure shape
- [ ] Authorization route-coverage matrix (every protected route → guard; every mutation → rate-limit)
- [ ] OWASP Top 10 walkthrough with file:line evidence
- [ ] Rate-limit coverage audit (auth strict 5/15min, write 60/min) — currently NOT implemented; CLAUDE.md §11.7 calls it out
- [ ] CORS + helmet config review (current: not yet wired — needed in API)
- [ ] Prioritized fix list with diffs

**Phase 2 — CI/CD plumbing (~½ day)** → `docs/CI_AND_BRANCH_PROTECTION.md`
- [ ] `.github/workflows/ci.yml` (lint + typecheck + test + build + `pnpm audit --audit-level=high`)
- [ ] `codeql.yml` (security-extended)
- [ ] `trivy.yml` (Docker image CVE — strict on push, soft on PRs)
- [ ] `secret-scan.yml` using bare gitleaks binary (NOT gitleaks-action — fails on Dependabot read-only token)
- [ ] `snyk.yml` (Service Account token, not UAT)
- [ ] `.github/dependabot.yml` (npm + actions; group minor/patch)
- [ ] Branch protection rules doc (manual UI step)
- [ ] Required GitHub secrets list
- [ ] **Gotchas to pre-empt:** pnpm/action-setup version-collision (use `packageManager` only), Dependabot read-only token (gate SARIF uploads to push-to-main), TS strict + monorepo `@types/node` per-package

**Phase 3 — Observability (~½ day)** — Sentry across all surfaces
- [ ] Init early (Node ESM: `--import ./instrument.js`); init both `apps/api` and `apps/web`
- [ ] PII filter in `beforeSend`/`beforeSendTransaction` — recursive walk of `request`/`extra`/`contexts`, redact keys matching CLAUDE.md §11.5 paths + Twilio body fields, OpenAI prompts/completions, Stripe metadata
- [ ] `request_id` tag from existing pino correlation id
- [ ] No-op when `SENTRY_DSN_*` empty
- [ ] Test with deliberate throws, then DELETE the test code
- [ ] Dotenv load-order: ensure config loads before any module reads `process.env.SENTRY_DSN`

**Phase 4 — Operational hygiene (~few hours)**
- [ ] Branded transactional email templates (Gmail-safe inline styles, table layout, light-mode-locked) — for Resend in Slice 10
- [ ] `docs/RUNBOOK_ENCRYPTION_KEY_ROTATION.md` (we already have versioned ciphertext format `v<N>:iv:tag:ct` — runbook covers add-old-key, dry-run, swap, verify, remove)
- [ ] CORS lockdown — production origin allowlist with no localhost; document each allowed origin
- [ ] Production header posture (HSTS preload, strict CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy) on both API and Web
- [ ] Token discipline — CI tokens never in `.env`; rotation calendar reminders

**Phase 5 — Auto-generated security report (~few hours)**
- [ ] `.github/workflows/security-report.yml` runs on push-to-main + weekly cron
- [ ] Aggregate `pnpm audit` + gitleaks + Trivy + CodeQL (`gh api`) + Dependabot alerts + production header snapshot into single Markdown
- [ ] Output to `$GITHUB_STEP_SUMMARY` + 90-day artifact
- [ ] v2: commit each report to `security-reports` branch (avoid main push-loop)

### Service-area follow-up: city/town centers via Google Maps Geocoding (Phase C)
Today the operator can express service area as (a) explicit ZIPs and (b) radius
zones around a center ZIP. Phase C adds:
- Operator types "Pasadena, CA" or "Austin, TX" instead of a center ZIP
- Server calls Google Maps Geocoding API to resolve to lat/lng, then runs the
  same haversine math to expand into the implied ZIP set
- Same denormalized output: ZIPs the AI sees in its prompt

**Blocked on:** waiting on Google to allow more projects on the user's billing
account. Once approved:
- Enable **Geocoding API** in `bookingblues-staging` (already exists for Calendar OAuth)
- Create an API-key credential restricted to **Geocoding API** + Railway egress IPs
- Add `GOOGLE_MAPS_API_KEY` to Railway api Variables
- Implement: extend `service_radius_zones` jsonb entries with `{kind: 'city'|'zip', value, radius_miles}`; service.expand caches geocoded results to limit API spend
- Free tier covers $200/month (~40k geocoding calls); after that $5/1000

Free fallback: **Nominatim (OpenStreetMap)** — no key, max 1 req/s/IP, attribute
OSM. Less accurate but acceptable for occasional operator setup.

### Slice 4-followup: billing flow gaps (surfaced during E2E 2026-05-07)
- [ ] **Trial → paid conversion test** — manually advance the trial via Stripe dashboard "Cancel trial / charge now", verify `customer.subscription.updated` flips status to `active`, dashboard reflects, no double-billing
- [ ] **Cancellation flow test** — operator clicks "Cancel" via Customer Portal (Settings → Billing → Open billing portal), verify `customer.subscription.deleted` → `subscription_status='canceled'`, dashboard banner, AI conversations gracefully degrade per §9.1 (greeting still plays, no booking, no fee). 7-day Twilio number grace then release.
- [ ] **Duplicate-checkout dedup** — `BillingService.createCheckoutSession` should refuse if `subscription_status IN ('trialing','active')` and there's an open subscription. Today, clicking "Start Trial" twice creates two Stripe subscriptions for the same customer (will double-bill on day 7).
- [ ] **Past-due degraded mode** — when `invoice.payment_failed` flips status to `past_due`, the AI advance loop should still run the call greeting + polite handoff SMS but skip booking + fee collection (CLAUDE.md §9.5 Flow A behavior). Today nothing in the AI loop checks subscription state.
- [ ] **Trial reminder emails** — day 3 (us, via pg-boss) + day 6 (us OR `customer.subscription.trial_will_end` via Stripe). Currently the webhook just logs; Slice 10 wires Resend.

### Slice 7-followup: pg-boss queue + delayed jobs (deferred from Slice 7)
- [ ] pg-boss setup, worker registration via `OnModuleInit`
- [ ] Replace synchronous `advance` call from SMS webhook with `queue.publish('conversation.advance', ...)`
- [ ] Workers: `conversation.advance`, `conversation.abandoned` (24h cron-style scheduling), `appointment.reminder` (1h before)
- [ ] Fee timeout (cancel `appointments` whose `fee_status='pending'` after a configurable window)
- [ ] Token-usage logging per advance (cost guardrail per CLAUDE.md §17 "OpenAI cost")

### Slice 7.5: Human-in-the-loop (HITL) via Slack — ✅ **shipped 2026-05-11**
The bot escalates to a human in Slack and stays bridged. The SMS channel never closes — Slack just becomes the operator's UI on the same conversation. The human can hand control BACK to the AI mid-thread when they're done, and the AI picks up the next caller message normally.

**Code complete; end-to-end test needs the Slack app to be created** via `docs/slack-app-manifest.yaml` + `docs/SLACK_SETUP.md`. Until then, the API serves the OAuth routes but no operator can actually install. The `escalate_to_human` tool still flips conversation status to `escalated` even when Slack isn't configured (no-op delivery + email fallback awaiting Slice 10).

**Triggers (both must be supported)**
- [x] AI-initiated: bot calls `escalate_to_human` (already exists in Slice 7) — auto-fires when bot is stuck (max-turn cap, calendar revoked, off-topic gray area, repeated tool failures)
- [x] Caller-initiated: caller texts something like "talk to a human" — system prompt already instructs the model to call `escalate_to_human` (system prompt §"Hard rules")
- [x] Operator-initiated from admin dashboard (Slice 15): admin can force-end via `/v1/admin/conversations/:id/force-end` — a dedicated "force-escalate" admin endpoint is a small follow-up (out of MVP scope)

**State machine extension** (CLAUDE.md §12 — `escalated` is now non-terminal)
- [x] When status='escalated', the AI advance loop **does not** pick up new caller messages — they're routed to the Slack thread via `EscalationsService.forwardCallerSmsToSlack` from `twilio-sms.controller.ts`
- [x] Operator hands back via `/bb back-to-bot` slash command OR the "Resume AI" button → `escalations` flips to `resolved`, conversation flips to `awaiting_caller`, the next caller SMS resumes advance with full history

**Schema** (migration `20260511000002_hitl_slack.sql`)
- [x] Migration: add `'slack'` to `webhook_source` enum
- [x] `slack_connections` table: `operator_id` (unique), `team_id`, `team_name`, `default_channel_id`, `encrypted_bot_token`, `scopes`, `installed_at`, `installed_by_user_id`, `status`
- [x] `escalations` table: full schema + `escalation_reason` / `escalation_status` / `escalation_opener` enums + `escalations_one_open_per_conversation` partial unique index + RLS (select-own for operator, service-role for writes)
- [x] `messages.slack_message_ts` column + sparse index

**Slack app**
- [x] Manifest YAML (`docs/slack-app-manifest.yaml`) with bot scopes, slash command, event subscriptions, interactivity URL, OAuth redirect URL
- [x] Per-operator workspace install flow (`/v1/operators/me/slack/install` → Slack OAuth → `/webhooks/slack/oauth/callback` → encrypted token written to `slack_connections`); state HMAC binds operator id so a third party can't redirect-attack the callback
- [ ] Channel picker UI on install — MVP uses the `incoming_webhook.channel` from the OAuth grant; explicit picker deferred to follow-up

**Bot ↔ Slack bridge**
- [x] `escalate_to_human` now opens a Slack escalation via `EscalationsService.openEscalation`: parent message (header + context + transcript) + action buttons `[Resume AI] [Mark spam] [Close] [Show number]`, captures `thread_ts` on `escalations`
- [x] Outbound: agent thread reply → `forwardAgentReplyToSms` → `twilio.sendSms` (rate-limited 8s/conversation per §9.3) + persists as `messages.role='system'` with the Twilio sid
- [x] Inbound: caller SMS during escalation → `forwardCallerSmsToSlack` posts to the existing thread (or no-ops if Slack failed open with email fallback) + stamps `messages.slack_message_ts`
- [x] PII: caller number shows as `•••<last4>` in the parent message; full number gated behind `[Show number]` button + `/bb show-number`, both audit-logged

**Slack interactions**
- [x] Slash commands: `/bb resolve`, `/bb close-spam`, `/bb back-to-bot`, `/bb show-number` (all live); `/bb book <ISO>` is a placeholder text response (Slice 9-followup)
- [x] Action buttons (`esc_back_to_bot`, `esc_mark_spam`, `esc_close`, `esc_show_number`) wire to the same handlers
- [x] Slack webhook signature verification via `SlackSignatureGuard` (v0 HMAC, 5-min replay window, raw-body buffer); idempotency via `webhook_events` with `source='slack'`

**Caps + safety**
- [x] One open escalation per conversation enforced by partial unique index `escalations_one_open_per_conversation` (second trigger reuses the existing row)
- [x] If Slack is configured but the bot can't post (channel deleted, token revoked, 429), `openEscalation` falls back to email path — `escalations.fallback_email_sent_at` records the fallback; actual email delivery awaits Slice 10's Resend wrapper
- [x] Audit log: `conversation.escalate`, `escalation.back_to_bot`, `escalation.resolve`, `escalation.show_number` — all via `AuditLogService`
- [ ] Slack `chat.postMessage` 1 msg/sec backoff — deferred; first 429 falls into `EscalationsService` catch and logs warn (no retry loop yet)

**Doc updates** — done in the same commit
- [x] CLAUDE.md §3 architecture diagram, §4 tech-stack row, §9.3 tool description, §10 endpoint list, §11 signature/audit/encryption notes (new items 21–23), §12 state-machine note
- [x] `docs/SLACK_SETUP.md` operator setup walkthrough
- [x] `docs/slack-app-manifest.yaml` (paste into api.slack.com)

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

### Slice 13.5: Custom domain cutover (pre-launch)
Currently we run on Railway-generated URLs (`bookingbluesapi-production.up.railway.app` /
`bookingbluesweb-production.up.railway.app`). Every provider config + env var
references them. Need a coordinated swap to a real owned domain
(e.g. `bookingblues.com` for web, `api.bookingblues.com` for API, or whatever
the chosen domain ends up being).

**DNS + TLS**
- [ ] Register / configure DNS records (A / CNAME) pointing to Railway services
- [ ] Configure custom domains in Railway dashboard for both api + web services — Railway provisions ACME certs automatically
- [ ] Verify HSTS preload still active on the new domains; submit to https://hstspreload.org/ once the production domain is stable
- [ ] Email sending: Resend domain verification (DKIM, SPF, DMARC) on the same root domain or a subdomain (e.g. `mail.bookingblues.com`)

**Provider config swap** (every URL referenced explicitly somewhere)
- [ ] **Supabase** (Auth → URL Configuration): Site URL + redirect URL allowlist updated to the new web domain. Old Railway URL removed once the cutover is verified to avoid open-redirect risk.
- [ ] **Stripe**:
  - Platform webhook endpoint URL (Developers → Webhooks → existing endpoint → Update) → new `https://<api domain>/webhooks/stripe`
  - Connect webhook endpoint URL → new `https://<api domain>/webhooks/stripe/connect`
  - Verify webhook signing secrets DON'T change on URL update (they shouldn't — but smoke a test event after each)
  - Checkout success_url / cancel_url already env-driven via `APP_URL`; updates with env var change
- [ ] **Google OAuth**:
  - Authorized redirect URIs in the OAuth Client → add the new `https://<api domain>/webhooks/google/oauth/callback`. Keep the old one until cutover, remove after.
  - OAuth Consent Screen → app domain + privacy policy URL + terms URL → update to the new domain
  - When ready to leave Testing mode and submit for verification, the production domain must be the one on file
- [ ] **Twilio**:
  - Existing provisioned numbers' voice + SMS webhook URLs (Console → Phone Numbers → each number) → swap from old Railway URL to new API domain. Or: write a one-shot script that iterates `incomingPhoneNumbers.list()` and updates each `voiceUrl` + `smsUrl`
  - Future provisions auto-pick up the new URL because the code uses `${env.API_URL}` — just update the env var
- [ ] **Sentry**:
  - Project → Settings → URL — update for nicer DSN URLs (cosmetic; existing DSNs keep working)
  - Add the new domain as the environment's "URL" so error events link to the right page
- [ ] **Resend** (when Slice 10 lands):
  - Sending domain swap (DKIM/SPF/DMARC); old domain decommission

**Env vars to update simultaneously** (every place we have hard-coded the Railway URL or its variants)
- [ ] `APP_URL` (api service)
- [ ] `API_URL` (api service)
- [ ] `NEXT_PUBLIC_APP_URL` (web service)
- [ ] `NEXT_PUBLIC_API_URL` (web service)
- [ ] `GOOGLE_OAUTH_REDIRECT_URI` (api service)
- [ ] `OUTBOUND_SMS_ALLOWLIST` — unchanged; phone numbers, not URLs
- [ ] CORS allowlist in `apps/api/src/main.ts` already pulls from `env.APP_URL` — auto-updates
- [ ] `docs/DEPLOY_RAILWAY.md` — replace example URLs throughout

**Validation gates**
- [ ] Sign up on new domain → email confirm link points to new domain (Supabase Site URL working)
- [ ] Onboarding step 1 trial → Stripe Checkout → return URL is new domain (Stripe webhook reaches new API)
- [ ] Onboarding step 4 Google connect → consent screen shows new domain → callback hits new API
- [ ] Onboarding step 3 Twilio number provisioning → number's voice/sms webhook URLs in Twilio Console show new API domain
- [ ] Real test call to the Twilio number → bot greeting + opening SMS works
- [ ] Run `curl -sI` against the new API + web domain — verify all the helmet headers + HSTS preload, no `X-Powered-By`

### Slice 15: Internal admin dashboard (REQUIRED pre-revenue) — ✅ **shipped 2026-05-11**
Operating a customer-facing SaaS without an internal control plane is untenable
— support tickets, dunning, fraud, refunds, abuse all need a "see + act" surface.
This is BookingBlues *staff* only, not Operator-facing. Distinct from CLAUDE.md §16
"Multi-user/teams per Operator" (which is post-MVP and rules out *Operator* teams).

**Decision recorded** in `docs/adr/0009-admin-role-via-app-metadata.md`: admin
role lives in `auth.users.app_metadata.role = 'admin'` (server-only-writable —
operators can't self-promote). Derived at JWT-verify time and surfaced on
`AuthenticatedUser.isAdmin`.

**Schema additions** (migration `20260511000001_admin_role_helper.sql`)
- [x] Picked `auth.users.app_metadata.role = 'admin'` (ADR 0009). No new table.
- [x] `audit_log` already existed (CLAUDE.md §8); shared `AuditLogService` writes from every admin action with IP + user-agent captured from the request.

**Auth + authorization**
- [x] `AdminGuard` (NestJS) composes `AuthGuard` + an `isAdmin` check. Fail-closed (returns false if the inner auth fails without an exception).
- [x] Admin web routes (`/admin/*`) gated by `apps/web/middleware.ts` reading `app_metadata.role`; non-admins redirected to `/dashboard`. Layout double-checks server-side.
- [x] Stricter throttle: 30/min reads, 10/min writes (vs. operator default 60/min).

**Read-only surfaces**
- [x] `GET /v1/admin/operators?cursor&q&status&has_twilio&has_calendar` — cursor pagination via base64-encoded `(created_at,id)` opaque token
- [x] `GET /v1/admin/operators/:id` — dossier: profile, subscription state, totals, Stripe/Twilio deep-links rendered in the dossier page
- [x] `GET /v1/admin/operators/:id/conversations` + `/v1/admin/conversations/:id/messages`
- [x] `GET /v1/admin/operators/:id/appointments`
- [x] `GET /v1/admin/operators/:id/payments`
- [x] `GET /v1/admin/operators/:id/audit-log`
- [x] `GET /v1/admin/metrics` — global counters: operators by status, conversations active now, escalations open, fee revenue MTD. MRR/ARR/trial→paid % and OpenAI cost MTD deferred (need a Stripe sync job + token-usage logging in Slice 7-followup; placeholder of 0 for now)

**Write actions (each writes `audit_log`)**
- [x] `POST /v1/admin/operators/:id/deactivate` — cancels Stripe subscription (immediate or end-of-period), closes in-flight conversations
- [x] `POST /v1/admin/operators/:id/release-twilio-number` — `incomingPhoneNumbers(sid).remove()`, marks `twilio_numbers.released`, clears operator fields
- [x] `POST /v1/admin/operators/:id/refund-payment/:paymentId` — wraps `PaymentsService.refundBookingFee` (which already handles `refund_application_fee: true` per §9.5)
- [x] `POST /v1/admin/operators/:id/cancel-subscription` — Stripe cancel, immediate OR end-of-period
- [x] `POST /v1/admin/conversations/:id/force-end` — set status `completed`, configurable outcome
- [x] `POST /v1/admin/operators/:id/impersonate` — Supabase magic-link generated via admin SDK; opens in a new private tab; reason required + audit-logged
- [x] `POST /v1/admin/admins` / `DELETE /v1/admin/admins/:userId` — admin promotion/demotion (an admin can't demote themselves)

**Web UI** (`apps/web/app/(admin)/...`)
- [x] `/admin` dashboard with global metric cards (warn-tone for past-due, escalations)
- [x] `/admin/operators` searchable table with status filter + cursor pagination
- [x] `/admin/operators/[id]` dossier — stats grid, action bar, tabs (conversations / appointments / payments / audit log), provider deep-links collapsible
- [x] Risky actions use the branded `ConfirmModal` with type-business-name for `Deactivate`; required free-text reason for every destructive action
- [x] Distinct admin theme: red banner ("BookingBlues Admin · Internal use only · Every action is logged"), red app-name + nav, separate route group

**Operational**
- [x] First admin: `admin_promote(text)` SQL function (SECURITY DEFINER, search_path pinned). Operator runs `select admin_promote('me@bb.com');` once from Supabase SQL editor; subsequent admins use the API
- [ ] Audit log retention policy — deferred to Slice 14 (production go-live)
- [x] Pre-launch hardening — AdminGuard tested for 403 on non-admin, 401 on bad token, true on isAdmin. JwtVerifierService tested for role derivation including the `user_metadata.role='admin'` injection attempt (correctly rejected — only `app_metadata.role` is trusted)

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

## 🪠 Plumbing-vertical pivot (2026-05-13 — captured from user roadmap)

Strategic narrowing: every signup from a non-plumbing trade is a wasted lead until
the product is dialed in. **Hide all non-plumbing categories, double down on the
plumber wedge, then expand.** No code is being deleted — non-plumbing trades come
back behind a feature flag once plumbing converts well.

The work splits cleanly into six themes. Each theme is roughly one slice of
build, but inside a theme items can ship independently.

### Slice 16 — Plumbing-only collapse (foundation) — ✅ **shipped 2026-05-14**

The unblocker. Shipped all three sub-items in the plumbing-MVP cut.

- [x] **(1) Hide non-plumbing categories** — `ENABLED_CATEGORIES` env (api)
      + `NEXT_PUBLIC_ENABLED_CATEGORIES` (web) feature-flag the 4 non-plumber
      categories. Wizard filter is client-side; `OperatorsService.update`
      enforces server-side rejection so a stale frontend can't bypass.
      DB seeds untouched — flip env to re-enable.
- [x] **(4) Plumbing-specific landing + FAQ + pricing teaser** — new hero
      ("Plumbers: never miss another emergency call."), plumber-tuned
      feature cards (emergency alerts, plumbing-tuned vetting, calendar +
      deposit), plumber testimonial placeholder, SMS mockup rewritten to a
      burst-pipe conversation. FAQ rewritten with 8 plumber-objection
      entries ("what if it tries to book a job I can't take?", "what
      about commercial calls?", "does it work with Jobber?").
- [x] **(15) STOP opt-out compliance copy** — opening SMS now ends with
      `Reply STOP to opt out. Msg & data rates may apply.` (Twilio
      enforces STOP/UNSTOP automatically — the disclosure is the only
      code change needed for 10DLC approval.) DB-level opt-out tracking
      deferred — not blocking 10DLC review.

### Slice 17 — Smarter scheduling & emergency triage

The #1 ask from plumber interviews. A burst pipe at 11pm is a different flow
than "leaky faucet, can wait."

- [ ] **(2) Drive-time aware booking + 90-min default slots** — every
      appointment is 90 min. Compute drive time between consecutive jobs on
      the operator's calendar (Google Distance Matrix API) and pad slot
      offerings accordingly so back-to-back jobs don't overrun.
- [ ] **(3) Emergency vs urgent vs scheduled routing** — AI classifies each
      call into one of three buckets:
      - *Emergency*: next available 90-min slot today, override standard
        business hours, push a mobile notification to the plumber.
      - *Urgent*: next available slot within 48 hours.
      - *Scheduled*: normal calendar logic.
- [x] **(17) Emergency detection — hybrid keyword + AI** — ✅ **shipped
      2026-05-14**. Keyword pre-filter (`emergency-detection.ts`) catches
      obvious phrases in 0 ms / $0. When the keyword path misses, an AI
      classifier (`emergency-classifier.service.ts`, `gpt-4.1-mini`) runs
      fire-and-forget against the inbound SMS — strict prompt distinguishes
      "leaky faucet" (no) from "basement filling up" (yes). On match, an
      alert SMS goes to the plumber's `personal_phone_e164` with the
      caller's number + AI-extracted reason. AI advance loop continues in
      parallel — no 60s timeout / fallback. Cost ~$0.0005 per
      AI-classified non-emergency call; $0 when the keyword path
      triggers.
- [ ] **(19) Repeat caller recognition** — if a number has called before, AI
      greets by name and references previous job: `Hi [name], welcome back.
      Last time we helped you with [job]. What's going on today?`

### Slice 18 — Activation & onboarding rebuild

The current funnel has a "calendar trap" — plumbers without Google Calendar
drop at step 4. Activation is the highest-leverage conversion knob.

- [ ] **(7) Onboarding wizard rebuild for plumber-specific friction**:
      - [ ] No Google Calendar? Offer to provision Google Workspace ($6/mo;
        BookingBlues covers it on Starter, plumber covers on Pro; 4-min
        guided flow).
      - [ ] Have Google but never use it? Short video walkthrough of adding it
        to iPhone.
      - [ ] Carrier-forwarding instructions rebuilt with **screenshots for all
        four major carriers** (Verizon, AT&T, T-Mobile, US Cellular). Test
        each on a real phone.
      - [x] **"Schedule a setup call with our team"** button at EVERY step
        — ✅ **shipped 2026-05-14**. Persistent banner above every onboarding
        step driven by `SETUP_CALL_BOOKING_URL` env (api) +
        `NEXT_PUBLIC_SETUP_CALL_BOOKING_URL` (web). Hidden when unset.
        Current target: `cal.com/malhotra-vikas/intro-session-30-minutes`.
- [ ] **(8) Demo mode toggle** — dashboard button "Demo my product" simulates
      an incoming call to the plumber's Twilio number, runs a fake plumbing
      conversation, books a fake appointment on their calendar marked
      `[DEMO]`. The activation moment that makes them believe. Show on sales
      calls.
- [ ] **(14) Plumber mobile dashboard (PWA)** — mobile-optimized: today's
      bookings, this week's revenue, unread notifications, quick-action
      "mark job done" + "contact customer". PWA only; native app is post-MVP.

### Slice 19 — Plumber business intelligence

Plumbers run their business on intuition. Showing them their numbers — clearly
formatted enough to forward to a spouse who handles bookkeeping — is sticky.

- [ ] **(9) Job-type pricing intelligence** — onboarding captures the
      plumber's pricing for the 15 most common job types ("basic kitchen
      faucet replacement", "water heater swap", etc.). AI quotes price
      ranges to callers, who self-select on price before the plumber
      arrives. Huge for caller-side conversion.
- [ ] **(10) Parts pre-pull / job summary email** — on booking, plumber gets
      a SMS/email: `Job booked for [time] at [address]. Customer reports:
      [diagnostic summary]. Likely parts: [list]. Estimated price quoted:
      $X-Y.` Lets plumber load the truck before driving. "The feature that
      gets posted about on Reddit."
- [ ] **(11) Daily summary email upgrade** — current daily summary is
      basic. Rebuild as a business report: `Yesterday: 4 calls received, 3
      booked, 1 marked spam, $1,200 in estimated revenue. This week: 18
      bookings, $5,400. Last week: $4,800. You're up 12%.` Forwardable to
      spouse / bookkeeper.
- [ ] **(21) Bookings analytics dashboard** — bookings by day of week,
      average job value over time, call-to-booked conversion rate, no-show
      rate, deposit collection rate. Data the plumber has never had access
      to.

### Slice 20 — Caller-side polish & reviews flywheel

- [ ] **(13) Caller-facing booking confirmation page** — one-page web view:
      `You're booked with [Plumber] on [date/time]. Address: [if needed]. To
      reschedule, text RESCHEDULE to this number.` Looks professional;
      increases show-up commitment.
- [ ] **(18) Review request automation** — 24h after job completion (known
      via Jobber/HCP integration when shipped — see Slice 21), SMS the
      customer: `Hi [name], hope [Plumber] took care of [issue]. If you
      have 30 seconds, a Google review really helps a small business:
      [direct link to their GMB review form].` More Google reviews →
      more inbound calls for the plumber. This is the feature that wins
      plumbers over.

### Slice 21 — Field-service integrations (Jobber, HCP)

This is what justifies Pro pricing and crushes churn at the 3–5-truck size.
Order matters: Jobber first (biggest market segment in our ICP), HCP second,
ServiceTitan deferred until we have 50+ paying customers (bigger ops are not
our immediate ICP).

- [ ] **(12) Jobber integration** — OAuth flow, then on AI-confirmed
      booking, also create the Jobber job with customer details, diagnostic
      notes, estimated price. 2–3 weeks build + test. Goal: listed in
      Jobber Marketplace.
- [ ] **(16) Housecall Pro integration** — same playbook as Jobber, ship
      AFTER Jobber is live + producing happy customers.
- [ ] (deferred) ServiceTitan — bigger segment, not immediate ICP; revisit
      after 50+ customers on the platform.

### Slice 22 — Network effects & AI quality

The investments that compound.

- [ ] **(20) Plumber-to-plumber referral hand-off** — when AI detects a job
      is out of scope for the current plumber (commercial when plumber is
      residential-only, out of service area, specialty work like septic),
      offer to refer to another BookingBlues plumber who covers it. Every
      BB plumber becomes a referral source for every other BB plumber.
      Revenue: $5 referral fee per accepted referral, split between
      platform + referring plumber.
- [ ] **(22) Rebuild the plumbing intake AI with a real plumber
      consultant** — the biggest single product investment. Hire a
      journeyman plumber for 20h at $100/h ($2k total). Elicit:
      - Every diagnostic question they ask on the phone before booking.
      - The 15–20 most common job types + typical pricing ranges.
      - Emergency vs scheduled triage logic ("what makes something a
        drop-everything emergency").
      - Red flags that trigger human handoff (insurance disputes, code
        violations, customers asking for unlicensed work).
      
      Rewrite the GPT-4.1 system prompt to encode this domain knowledge.
      Build a few-shot example library of 30–50 conversations. Test against
      100 simulated calls before going live.

### Sequencing notes

- **Slice 16** is the unblocker — runs first. Cheapest, highest leverage.
- **Slice 17 + 18 + 19** can run in parallel after 16. Different files,
  different surface areas.
- **Slice 21 (Jobber)** is gated on having a real plumber on the platform to
  validate the integration round-trip with. Don't start until 1–2 paying
  plumbers exist.
- **Slice 22 (AI rebuild)** is gated on having interview material from the
  consultant — schedule the 20h block when the plumbing-only landing page
  starts driving signups.

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
