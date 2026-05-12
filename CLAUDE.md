# CLAUDE.md — BookingBlues

This file is the source of truth for Claude Code working in this repo. Read it fully before making changes. When something here is wrong or out of date, fix this file in the same PR as the code change.

---

## 1. Product Overview

**BookingBlues** converts missed calls into booked appointments for blue-collar service businesses (plumbers, roofers, HVAC, electricians, garage door, locksmith, pest control, landscaping). The contractor never picks up a missed call again, and never loses a job to a competitor who answered first.

**End-user (the "Operator")**: a small contractor or solo trade pro.
**Caller**: a homeowner or property manager trying to reach the Operator.

**Value loop**:
1. Operator signs up, pays subscription, gets a Twilio number, connects Google Calendar.
2. Operator forwards busy/no-answer calls to their Twilio number (carrier conditional forwarding).
3. Caller dials Operator, hits voicemail / no answer, gets forwarded to Twilio.
4. Twilio plays a brief greeting, hangs up, and immediately texts the caller.
5. Our AI bot conducts an SMS conversation, scoped strictly to the Operator's trade category.
6. Bot vets the caller, captures job details, proposes available time slots from Google Calendar, books the appointment.
7. Bot optionally collects a non-refundable booking fee via the Operator's Stripe Connect account.
8. Confirmation SMS + email to both Operator and Caller.

Everything else is secondary. If a feature does not directly serve this loop, it is post-MVP.

---

## 2. How Claude Code Should Work in This Repo

- **Read before writing.** Before touching a domain, read its module's README and any related migrations. Domains: `auth`, `admin`, `billing`, `telephony`, `calendar`, `conversations`, `appointments`, `payments`, `slack`.
- **Stay in scope.** If a task drifts beyond what was asked, surface it as a follow-up rather than expanding the diff.
- **Schema changes are migrations.** Never edit a committed migration. Add a new one.
- **No silent fallbacks for external services.** If Twilio, Stripe, OpenAI, or Google fail, fail loudly with a structured error, retry per the documented policy, and alert. Never swallow.
- **Webhooks are append-only event handlers.** Idempotency keys required for every webhook handler.
- **No PII in logs.** Mask phone numbers (last 4 only), emails (first char + domain), and never log message bodies at info level.
- **Follow the existing module pattern.** NestJS modules are vertical slices: controller, service, repository, dto, types, tests, all in one folder.

---

## 3. Architecture

```
                         +-------------------+
                         |  Caller's phone   |
                         +---------+---------+
                                   | (1) calls Operator
                                   v
                         +---------+---------+
                         | Operator's mobile |
                         +---------+---------+
                                   | (2) busy / no answer, conditional forward
                                   v
                         +---------+---------+
                         |  Twilio Number    |
                         | (assigned to Op)  |
                         +---------+---------+
                            |             |
            (3) Voice TwiML |             | (4) inbound SMS
            -> brief greet  |             |     webhook
               + hangup     |             |
                            v             v
                         +---------+---------+
                         |   API (NestJS)    |
                         |   on Railway      |
                         +---------+---------+
                            |     |     |
              +-------------+     |     +--------------+
              v                   v                    v
     +--------+------+   +--------+--------+   +-------+--------+
     |   Supabase    |   |   OpenAI API    |   | Twilio (out)   |
     |  (Postgres,   |   | (chat + tools)  |   | Google Cal API |
     |   Auth, RLS)  |   |                 |   | Stripe API     |
     +---------------+   +-----------------+   +----------------+

                         +-------------------+
                         |  Web (Next.js)    |
                         |  on Railway       |
                         +-------------------+
                                   ^
                                   | HTTPS, Supabase auth cookie
                            Operator dashboard,
                            signup, settings,
                            onboarding wizard,
                            /admin (staff-only)

                         +-------------------+
                         |  Slack            |
                         |  (single BB-team  |
                         |   workspace —     |
                         |   ADR 0010)       |
                         +---------+---------+
                                   ^
                                   | (HITL — Slice 7.5)
                                   | escalations, slash cmds,
                                   | interactive blocks
                                   v
                                  API
```

The API is the only service that talks to Twilio, OpenAI, Stripe, and Google. The Web app talks only to the API and Supabase Auth.

---

## 4. Tech Stack (locked for MVP)

| Layer | Choice | Reason |
|---|---|---|
| Package manager | pnpm | Workspace-native, fast, deterministic |
| Monorepo | Turborepo | Caching, task graph, minimal config |
| API | NestJS (Node 22, TypeScript strict) | Module boundaries, DI, mature webhook patterns |
| Web | Next.js 15 (App Router, TypeScript strict) | Operator dashboard, marketing pages, Stripe Checkout redirect |
| Database | Supabase Postgres | Managed Postgres, RLS, generated types |
| Auth | Supabase Auth (email + password, magic link) | First-party with the DB, RLS integration |
| ORM / DB client | `@supabase/supabase-js` with generated types | Single source of truth, RLS-aware |
| Migrations | Supabase CLI migrations (`supabase/migrations/*.sql`) | Reviewable SQL, no ORM drift |
| Telephony | Twilio (Programmable Voice + Messaging) | Number provisioning API, mature SMS |
| AI | OpenAI Chat Completions, model `gpt-4.1-mini` for routing, `gpt-4.1` for booking | Tool calling, structured outputs |
| Calendar | Google Calendar API v3 | Required by Operator audience |
| Payments | Stripe (Subscriptions for BookingBlues SaaS, Connect Express for Operator booking fees) | Industry standard, marketplace pattern |
| Email | Resend | Simple API, good DX, transactional only |
| HITL | Slack (single BB-team workspace, ADR 0010) | BB internal team handles escalations; one bot token in env, one shared #hitl channel for all operators |
| Queue | Postgres-backed via `pg-boss` | One less infra dependency for MVP |
| Deployment | Railway (API + Web as separate services) | Operator preference, simple env management |
| Logging | Pino with redaction config | Structured JSON, PII redaction built-in |
| Error tracking | Sentry | Both API and Web |
| Observability | Railway logs + Sentry for MVP. Add OpenTelemetry post-MVP. | |

Do not introduce new top-level dependencies without updating this file and the architecture decision record.

---

## 5. Repository Layout

```
bookingblues/
├── apps/
│   ├── api/                    # NestJS API
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── billing/         # BookingBlues subscription
│   │   │   │   ├── telephony/       # Twilio numbers, voice TwiML, SMS
│   │   │   │   ├── conversations/   # SMS conversation state machine
│   │   │   │   ├── ai/              # OpenAI client, prompts, tool dispatch
│   │   │   │   ├── calendar/        # Google OAuth, free/busy, insert event
│   │   │   │   ├── appointments/
│   │   │   │   ├── payments/        # Stripe Connect, booking fees
│   │   │   │   ├── operators/       # Operator profile, category, settings
│   │   │   │   └── webhooks/        # Twilio, Stripe, Google webhook entrypoints
│   │   │   ├── common/              # guards, interceptors, filters, decorators
│   │   │   ├── config/              # env loading, validation
│   │   │   ├── jobs/                # pg-boss workers
│   │   │   └── main.ts
│   │   ├── test/
│   │   └── README.md
│   └── web/                    # Next.js
│       ├── app/
│       │   ├── (marketing)/         # /, /pricing, /faq
│       │   ├── (auth)/              # /login, /signup
│       │   ├── (dashboard)/         # /dashboard, /settings, /appointments
│       │   └── api/                 # only thin proxies if absolutely needed
│       ├── components/
│       ├── lib/
│       └── README.md
├── packages/
│   ├── shared/                 # shared types, zod schemas, constants
│   ├── db-types/               # Supabase generated types (pnpm gen:db)
│   └── config/                 # eslint, tsconfig, prettier presets
├── supabase/
│   ├── migrations/             # numbered .sql files, append-only
│   ├── seed.sql
│   └── config.toml
├── .env.example
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── CLAUDE.md                   # this file
```

---

## 6. Local Development

**Prerequisites**: Node 22, pnpm 9, Docker (for local Supabase), Stripe CLI, Twilio CLI, ngrok or `tailscale serve` for inbound webhooks.

**Setup**:
```bash
pnpm install
cp .env.example .env.local
supabase start
pnpm gen:db                       # generate db-types from local supabase
pnpm dev                          # turbo dev across apps
```

**Webhook tunneling** (one terminal each):
```bash
ngrok http 3001                   # API
stripe listen --forward-to http://localhost:3001/webhooks/stripe
twilio phone-numbers:update <NUM> --sms-url=<ngrok>/webhooks/twilio/sms --voice-url=<ngrok>/webhooks/twilio/voice
```

**Common commands**:
```bash
pnpm dev                          # run all apps
pnpm dev --filter api             # run api only
pnpm test                         # all tests
pnpm test --filter api            # api tests only
pnpm lint
pnpm typecheck
pnpm gen:db                       # regenerate Supabase types
pnpm db:migration:new <name>      # new migration file
pnpm db:reset                     # nuke local DB and reapply migrations + seed
```

---

## 7. Environment Variables

All variables loaded via `apps/api/src/config/env.ts` using `zod` validation. The API will refuse to boot with missing or invalid env vars. The Web app has its own narrower zod schema.

| Var | Used by | Purpose |
|---|---|---|
| `NODE_ENV` | both | `development` / `production` / `test` |
| `APP_URL` | both | Public URL of the Web app, e.g. `https://bookingblues.com` |
| `API_URL` | both | Public URL of the API |
| `SUPABASE_URL` | both | Project URL |
| `SUPABASE_ANON_KEY` | web | RLS-bounded client key |
| `SUPABASE_SERVICE_ROLE_KEY` | api only | Bypasses RLS. Never expose to web. |
| `SUPABASE_JWT_SECRET` | api | Verify Supabase-issued JWTs |
| `TWILIO_ACCOUNT_SID` | api | |
| `TWILIO_AUTH_TOKEN` | api | Used to validate webhook signatures |
| `TWILIO_API_KEY_SID` | api | API key for outbound calls |
| `TWILIO_API_KEY_SECRET` | api | |
| `TWILIO_MESSAGING_SERVICE_SID` | api | Optional, for sender pool |
| `OPENAI_API_KEY` | api | |
| `STRIPE_SECRET_KEY` | api | Platform key |
| `STRIPE_WEBHOOK_SECRET` | api | Platform webhook secret |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | api | Connected accounts webhook secret |
| `STRIPE_PRICE_STARTER` | api | BookingBlues Starter plan price ID |
| `STRIPE_PRICE_PRO` | api | |
| `STRIPE_PUBLISHABLE_KEY` | web | |
| `PLATFORM_TAKE_RATE_BPS` | api | Default 1000 (10%) for booking fee cut |
| `MIN_PLATFORM_FEE_CENTS` | api | Default 100 ($1.00) floor on platform fee |
| `TRIAL_DAYS` | api | Default 7; mirrored on Stripe Checkout creation |
| `GOOGLE_OAUTH_CLIENT_ID` | api | |
| `GOOGLE_OAUTH_CLIENT_SECRET` | api | |
| `GOOGLE_OAUTH_REDIRECT_URI` | api | |
| `RESEND_API_KEY` | api | |
| `ENCRYPTION_KEY` | api | 32-byte hex, AES-256-GCM key for at-rest encryption of Google refresh tokens |
| `SENTRY_DSN_API` | api | |
| `SENTRY_DSN_WEB` | web | |
| `LOG_LEVEL` | api | `info` in prod, `debug` in dev |
| `SLACK_BOT_TOKEN` | api | `xoxb-…` for the single BookingBlues-team workspace (ADR 0010). Must be redacted in logs. |
| `SLACK_DEFAULT_CHANNEL_ID` | api | Channel ID where all HITL escalations post (e.g. `C0123ABCDEF`). |
| `SLACK_SIGNING_SECRET` | api | HMAC secret used by `SlackSignatureGuard` to verify inbound webhooks (events, commands, interactivity). |

Rotation: `ENCRYPTION_KEY` is versioned; the encryption helper writes a key version prefix on every ciphertext so we can rotate without downtime. See `apps/api/src/common/crypto/encryption.service.ts`.

---

## 8. Database Schema

All tables live in the `public` schema. Every table has `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, and `updated_at timestamptz default now()` with a trigger.

**Multi-tenancy rule**: every Operator-scoped row carries `operator_id uuid references operators(id) on delete cascade`. RLS uses this column.

### Core tables

```
operators
  id, user_id (FK auth.users), business_name, category (enum),
  trade_metadata jsonb,            -- e.g. license number, service area zip codes
  personal_phone_e164, twilio_number_e164 (nullable until provisioned),
  twilio_number_sid (nullable),
  google_calendar_id (nullable), google_calendar_connected_at,
  booking_fee_enabled bool default false,
  booking_fee_cents (nullable),     -- only meaningful if enabled
  stripe_customer_id, stripe_subscription_id,
  subscription_status,              -- 'trialing','active','past_due','canceled','incomplete','incomplete_expired'
  trial_ends_at timestamptz,        -- mirrors Stripe; gate UI off this
  stripe_connect_account_id (nullable),
  stripe_connect_charges_enabled bool default false,
  stripe_connect_payouts_enabled bool default false,
  onboarding_completed_at,
  timezone (IANA, e.g. America/New_York),
  business_hours jsonb              -- { mon: [{start, end}], ... }

categories  (lookup table, seeded)
  slug (pk: 'plumbing','roofing','hvac','electrical', ...),
  display_name, vetting_questions jsonb, system_prompt_template

calendar_connections
  operator_id (unique),
  provider ('google'),
  encrypted_refresh_token bytea,    -- AES-256-GCM, with key version prefix
  access_token_cache text, access_token_expires_at,
  scopes text[],
  connected_email

twilio_numbers
  id, phone_number_e164 (unique), twilio_sid (unique),
  operator_id (nullable -> assigned), status ('available','assigned','released'),
  purchased_at, released_at

conversations
  id, operator_id, caller_phone_e164,
  status ('active','awaiting_caller','awaiting_bot','completed','abandoned','escalated'),
  last_message_at, started_at, completed_at,
  outcome ('booked','no_show_intent','out_of_scope','spam','rejected','timeout'),
  summary text                       -- written at end-of-conversation
  unique (operator_id, caller_phone_e164, started_at)

messages
  id, conversation_id, role ('caller','bot','system'),
  body text,
  twilio_message_sid (nullable, only for caller/bot),
  ai_tool_calls jsonb,               -- when role='bot' and a tool was used
  created_at

appointments
  id, operator_id, conversation_id (nullable for manual entries),
  caller_phone_e164, caller_name, caller_email (nullable),
  job_summary text,
  scheduled_for_start timestamptz, scheduled_for_end timestamptz,
  google_event_id (nullable),
  status ('proposed','confirmed','cancelled','completed','no_show'),
  fee_cents (nullable), fee_status ('none','pending','paid','refunded','expired'),
  fee_payment_intent_id (nullable),
  fee_checkout_session_id (nullable)

payments
  id, operator_id, appointment_id, type ('booking_fee'),
  stripe_connected_account_id,      -- the operator's Connect account, denormalized
  stripe_payment_intent_id (unique),
  stripe_charge_id (nullable),
  amount_cents,                     -- gross charged to caller
  application_fee_cents,            -- our cut, settled to platform automatically
  currency,
  status ('pending','succeeded','failed','refunded','partially_refunded'),
  refunded_at,
  raw_event jsonb,
  created_at

webhook_events
  id, source ('twilio','stripe','stripe_connect','google'),
  event_id (provider id), signature_verified bool,
  payload jsonb, processed_at, error text,
  unique (source, event_id)          -- IDEMPOTENCY KEY

audit_log
  id, actor_user_id (nullable), operator_id (nullable),
  action, resource_type, resource_id, metadata jsonb, ip_address, user_agent
```

### RLS policies (MVP set)

- `operators`: SELECT/UPDATE only where `user_id = auth.uid()`. INSERT only via API service role.
- `appointments`, `conversations`, `messages`, `payments`, `calendar_connections`: SELECT only where `operator_id` belongs to `auth.uid()`. All writes via service role from API.
- `webhook_events`, `audit_log`, `twilio_numbers`, `categories`: no anon/authenticated access. Service role only.

The Web app uses the anon key and reads via RLS. The API uses the service role and is responsible for authorization checks itself, with RLS as defense in depth.

### Migration discipline

- Numbered files, e.g. `20260105_0001_create_operators.sql`.
- Forward-only. No `down`. To revert, write a new forward migration.
- Each migration is reviewed for: RLS, indexes, FK cascade behavior, default values for existing rows.

---

## 9. Core Workflows

### 9.1 Operator signup & onboarding

1. Visitor lands on `/pricing`, picks plan, clicks Subscribe.
2. Web creates a Supabase Auth user (email/password), then calls `POST /api/billing/checkout-session` which creates a Stripe Checkout Session in subscription mode with:
   - `client_reference_id = operators.id`
   - `subscription_data.trial_period_days = 7`
   - `payment_method_collection = 'always'` (card required at signup; reduces trial abuse and improves conversion)
   - `subscription_data.trial_settings.end_behavior.missing_payment_method = 'cancel'`
3. Stripe webhook `checkout.session.completed` updates `operators.subscription_status='trialing'`, sets `trial_ends_at`, and stores `stripe_subscription_id`. Trial users get full feature access.
4. Onboarding wizard (gated by `subscription_status IN ('trialing','active')`):
   - Step 1: Pick category (plumbing, roofing, etc.). Stored on `operators.category`.
   - Step 2: Enter personal phone (E.164 normalized via `libphonenumber-js`). We send a verification SMS via Twilio Verify.
   - Step 3: Provision Twilio number. API picks a local number in the Operator's area code (best effort), purchases it, attaches it to `twilio_numbers`, links it to `operators.twilio_number_sid`. Configure SMS and Voice webhook URLs.
   - Step 4: Connect Google Calendar (OAuth, scopes `calendar.events` and `calendar.readonly` for free/busy). Refresh token encrypted at rest.
   - Step 5: Booking fee config (optional, off by default). If Operator opts in, set `booking_fee_enabled=true`, set `booking_fee_cents`, and kick off Stripe Connect Express onboarding to collect the Operator's payout details. Cannot collect or transfer fees until both `charges_enabled=true` (on platform side, automatic) and `payouts_enabled=true` (on connected account).
   - Step 6: Show carrier-specific conditional forwarding instructions for the Operator's mobile carrier.
5. Set `onboarding_completed_at`. Dashboard becomes accessible.

**Trial state handling**:
- Days 3 and 6: trial reminder emails via Resend.
- Day 7: Stripe automatically attempts to charge the saved card. Webhook `customer.subscription.updated` flips status to `active` on success, or `past_due` / `canceled` on failure.
- If trial converts to `past_due`: same degraded mode as in 9.5 Flow A (greeting plays, polite SMS, no AI booking, no fee collection).
- If status becomes `canceled` or `incomplete_expired`: release the Twilio number after a 7-day grace, mark calendar connection inactive, archive conversations and appointments (read-only). Operator data retained for 30 days then purged on schedule (compliance + reactivation friendly).

### 9.2 Inbound call to SMS handoff (the critical path)

1. Caller dials Operator's mobile, no answer, carrier forwards to the Operator's Twilio number.
2. Twilio POSTs to `/webhooks/twilio/voice/:operatorId`. We respond with TwiML:
   ```xml
   <Response>
     <Say voice="Polly.Joanna">Thanks for calling {business_name}. They are with another customer. We will text you right away to schedule.</Say>
     <Hangup/>
   </Response>
   ```
3. Same handler enqueues a `conversation.start` job. The job:
   - Creates or resumes a `conversations` row (status `awaiting_bot`).
   - Sends the opening SMS via Twilio Messaging API. Opening message is category-specific and includes Operator business name.
   - Logs an `audit_log` entry.
4. Caller replies via SMS. Twilio POSTs to `/webhooks/twilio/sms/:operatorId`.
5. Webhook handler validates signature, finds or creates conversation, persists message, enqueues `conversation.advance` job.
6. Worker calls OpenAI with conversation history + tools (see 9.3). Persists bot response and any tool results. Sends bot SMS reply via Twilio.
7. Loop continues until tool `book_appointment` succeeds, or bot determines `out_of_scope` / `spam` / max-turn threshold reached.

### 9.3 AI conversation logic

**Model selection**: `gpt-4.1` for the booking flow. Lower-cost models are not yet reliable enough at tool selection for this domain. Re-evaluate quarterly.

**System prompt** is composed of:
- Static frame (rules, persona, refusal policy).
- Operator block: business name, category, timezone, business hours, service area, current date/time.
- Category template from `categories.system_prompt_template` (e.g. plumbing prompt enumerates job types: leak, water heater, drain, fixture, etc., and required vetting questions).
- Booking fee block, if configured.

**Tools** (function calling):
- `check_availability(window_start, window_end)` — returns free 60-minute slots from Google Calendar within Operator's business hours, in the Operator's timezone.
- `propose_slots(slots[])` — formats a human SMS-friendly proposal. (Pure formatting helper; could be inlined.)
- `book_appointment({ start, end, caller_name, caller_email?, job_summary, urgency })` — creates the Google Calendar event and `appointments` row. Also triggers confirmation send and, if booking fee enabled, the fee Checkout session.
- `request_payment_link(appointment_id)` — generates a Stripe Connect Checkout link tied to the Operator's connected account, sends URL via SMS.
- `mark_out_of_scope(reason)` — ends conversation, sends polite handoff message.
- `mark_spam(reason)` — silent end, no further messages.
- `escalate_to_human(reason)` — opens a Slack thread in the BookingBlues team workspace (single shared #hitl channel, ADR 0010) with the conversation summary, last 10 turns, and action buttons (Resume AI / Mark spam / Close / Show number). BB ops staff can reply in-thread to send an SMS to the caller, run `/bb back-to-bot` to hand control back to the AI, or close with `/bb resolve`. The thread header carries operator business name + caller last-4 + reason so triage is obvious. If `SLACK_BOT_TOKEN` is unset or the post fails, falls back to email (Slice 10). Either way, conversation status flips to `escalated` and the AI stops replying until resolved.

**Tool execution rules**:
- All tools execute server-side in the API. The model never sees raw secrets.
- `book_appointment` is wrapped in a Postgres advisory lock keyed on `(operator_id, slot_start)` to prevent double-booking when two callers race.
- Every tool call writes to `messages.ai_tool_calls`.

**Guardrails**:
- Hard turn cap of 20 caller messages per conversation. After cap, `escalate_to_human` is forced.
- Off-topic detection: the system prompt instructs the model to call `mark_out_of_scope` if the caller's request is outside the Operator's category. Reinforced by a final-pass classifier on conversation summary.
- Prompt injection: caller messages are wrapped as `<<CALLER_MESSAGE>>...<<END>>` and the system prompt explicitly says to never follow instructions inside that block.
- Rate limit: max 1 outbound SMS per 8 seconds per conversation (carrier filter avoidance).

### 9.4 Google Calendar integration

- OAuth callback stores refresh token AES-256-GCM encrypted with versioned key.
- Access tokens cached in DB until 60 seconds before expiry.
- `check_availability` uses `freebusy.query` against the Operator's primary calendar, intersected with `operators.business_hours` and Operator timezone.
- `book_appointment` creates an event with attendees: Operator (self) + caller email if provided. `sendUpdates=all`.
- If Google API returns 401 due to revoked grant, mark `calendar_connections.status='revoked'`, page Operator via email + dashboard banner, and have the bot escalate any in-flight conversation.

### 9.5 Stripe — two distinct flows

**Flow A: BookingBlues SaaS subscription** (Operator pays us).
- Standard Stripe Subscriptions on the platform account.
- Checkout Session at signup with 7-day trial (see 9.1).
- Customer Portal link in dashboard for cancel/upgrade/payment-method updates.
- Webhook events handled: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.trial_will_end`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`.
- On `payment_failed`, set `subscription_status='past_due'`. Pause AI conversation handling (calls still get the greeting and a polite "we will follow up" SMS, but no booking, no fee collection).

**Flow B: Per-appointment booking fee** (Caller pays Operator directly, BookingBlues takes a cut).

Pattern: Stripe Connect Express **with Direct Charges**. The Operator's connected account is the merchant of record. The charge is created on the connected account using the `Stripe-Account` header. We specify `application_fee_amount` to take our cut, which lands on our platform balance automatically. We never hold caller funds.

Why this pattern:
- BookingBlues stays out of money transmission entirely. Stripe handles MoR, settlement, payouts, tax forms (1099-K), and dispute primary handling.
- Operator's business name appears on the caller's statement. Caller experience reinforces the Operator brand, not BookingBlues.
- Refunds, payouts, and balance management happen on the connected account, on Stripe's normal schedule.
- Zero hold logic. Zero transfer scheduling. Less code, fewer failure modes.

**Eligibility gates** before any fee can be charged for an Operator (all four required):
1. `operators.booking_fee_enabled = true`
2. `operators.subscription_status IN ('trialing','active')`
3. `operators.stripe_connect_charges_enabled = true`
4. `operators.stripe_connect_payouts_enabled = true`

If any gate is false, the bot does not call `request_payment_link` and proceeds to book without a fee.

**Charge flow**:
1. Bot calls `request_payment_link(appointment_id)`.
2. API creates a Stripe Checkout Session **on the connected account**:
   ```
   stripe.checkout.sessions.create({
     mode: 'payment',
     line_items: [{ price_data: { ... fee_cents ... }, quantity: 1 }],
     payment_intent_data: {
       application_fee_amount: <our cut, computed via pricingService>,
       metadata: { operator_id, appointment_id, payment_id }
     },
     client_reference_id: appointment_id,
     success_url, cancel_url
   }, { stripeAccount: operator.stripe_connect_account_id })
   ```
3. Bot sends the Checkout URL via SMS.
4. Caller pays. Webhook `payment_intent.succeeded` arrives on the **Connect** endpoint (`/webhooks/stripe/connect`) with the connected account's ID in the event envelope. We set `payments.status='succeeded'`, `appointments.fee_status='paid'`. Done. No further settlement work.

**Refunds**:
- Operator-initiated cancel from dashboard: API issues refund on the connected account with `refund_application_fee: true` so our cut is also returned. Persist `payments.status='refunded'`, `refunded_at`.
  ```
  stripe.refunds.create({
    payment_intent: payments.stripe_payment_intent_id,
    refund_application_fee: true,
    reverse_transfer: false   // direct charge, not destination charge
  }, { stripeAccount: operator.stripe_connect_account_id })
  ```
- Caller-initiated chargeback: routed to the Operator's connected account; surfaced to Operator in their dashboard with evidence-submission UI. Our application fee is automatically reversed by Stripe on lost disputes.
- If the connected account has insufficient balance to cover a refund, Stripe creates a negative balance recovered from the next payout. Surface this in Operator UX.

**Take rate config**:
- `PLATFORM_TAKE_RATE_BPS` env var, MVP default `1000` (10%).
- `MIN_PLATFORM_FEE_CENTS` env var, MVP default `100` ($1.00 floor).
- `application_fee_amount` cannot exceed the charge amount minus Stripe processing fees (Stripe will reject). The pricing service must clamp accordingly.
- Per-plan override comes after MVP; do not build per-Operator overrides.

**Webhook security**:
- Two separate Stripe endpoints, two separate signing secrets:
  - `/webhooks/stripe` (platform): subscription billing events for BookingBlues SaaS itself.
  - `/webhooks/stripe/connect` (Connect): all booking-fee charge events plus connected account state events (`account.updated` for KYC and capability changes).
- Critical: the Connect webhook envelope contains `account` (the connected account ID). Always cross-reference this against `operators.stripe_connect_account_id` before mutating state. Mismatch = reject.
- Signature verification before any DB write.
- Idempotency via `webhook_events` unique constraint on `(source, event_id)`.

### 9.6 Notifications

- Confirmation SMS to caller and Operator immediately after `book_appointment` succeeds.
- Email confirmation to Operator (always) and caller (if email captured) via Resend.
- 1-hour-before reminder to caller (cron job via pg-boss).
- All outbound SMS templates live in `apps/api/src/modules/conversations/templates/`. No inline strings.

---

## 10. API Surface

REST, JSON, versioned at `/v1`. All Operator-scoped endpoints require Supabase JWT in `Authorization: Bearer`.

### Auth-protected (Operator)
```
GET    /v1/me
PATCH  /v1/me
GET    /v1/operators/me
PATCH  /v1/operators/me                  # update category, business_name, hours, fee
GET    /v1/operators/me/onboarding-status
POST   /v1/operators/me/twilio-number    # provision
POST   /v1/operators/me/google/connect   # returns OAuth URL
POST   /v1/operators/me/google/disconnect
POST   /v1/operators/me/connect/onboarding-link  # Stripe Connect Express
GET    /v1/billing/portal-session
POST   /v1/billing/checkout-session
GET    /v1/conversations?cursor=&status=
GET    /v1/conversations/:id
GET    /v1/appointments?cursor=&status=&from=&to=
GET    /v1/appointments/:id
PATCH  /v1/appointments/:id              # cancel, mark complete
GET    /v1/dashboard/metrics             # missed-calls captured, booked, fee revenue, MRR contribution
```

### Public (no auth)
```
GET    /v1/health
GET    /v1/categories
```

### Webhooks (signature-verified, no JWT)
```
POST   /webhooks/twilio/voice/:operatorId
POST   /webhooks/twilio/sms/:operatorId
POST   /webhooks/stripe                  # platform
POST   /webhooks/stripe/connect          # connected accounts
GET    /webhooks/google/oauth/callback   # OAuth redirect target
POST   /webhooks/slack/events            # Events API (HMAC X-Slack-Signature)
POST   /webhooks/slack/commands          # /bb slash commands
POST   /webhooks/slack/interactivity     # block actions (buttons)
```

### Admin (Slice 15 — staff only, `app_metadata.role='admin'`)
```
GET    /v1/admin/metrics                              # global counters
GET    /v1/admin/operators?cursor=&q=&status=
GET    /v1/admin/operators/:id                        # dossier
GET    /v1/admin/operators/:id/conversations
GET    /v1/admin/operators/:id/appointments
GET    /v1/admin/operators/:id/payments
GET    /v1/admin/operators/:id/audit-log
GET    /v1/admin/conversations/:id/messages
POST   /v1/admin/admins                               # promote (existing admin required)
DELETE /v1/admin/admins/:userId                       # demote (can't demote self)
POST   /v1/admin/operators/:id/deactivate
POST   /v1/admin/operators/:id/cancel-subscription
POST   /v1/admin/operators/:id/release-twilio-number
POST   /v1/admin/operators/:id/refund-payment/:paymentId
POST   /v1/admin/operators/:id/impersonate            # short-lived magic link
POST   /v1/admin/conversations/:id/force-end
```

### OAuth callback (Operator-initiated)
```
GET    /v1/oauth/google/callback         # Auth-protected, completes calendar connection
```

### Standards
- Errors: RFC 7807 Problem Details JSON.
- Pagination: cursor-based, opaque `cursor` token.
- Timestamps: ISO 8601 UTC.
- Phone numbers: E.164.
- Money: integer cents + ISO currency code.

---

## 11. Security Requirements (non-negotiable)

1. **Webhook signature validation on every webhook**, before any side effect. Twilio (`X-Twilio-Signature`), Stripe (`Stripe-Signature`), Google (verify `state` and OAuth code exchange), Slack (`X-Slack-Signature` v0 HMAC over `v0:<timestamp>:<rawBody>` with a 5-minute replay window). Validators live in `common/webhook-signatures/` and `modules/slack/slack-signature.guard.ts`.
2. **Idempotency** for all webhooks via the `webhook_events` table.
3. **RLS enabled on every operator-scoped table.** Default deny. Service role used only by API, never exposed.
4. **Encryption at rest for Google refresh tokens** with versioned AES-256-GCM key (`ENCRYPTION_KEY`). No tokens in plaintext, ever, including in logs.
5. **PII redaction in logs** via Pino redact paths: `req.body.From`, `req.body.To`, `req.body.Body`, `*.phone`, `*.email`, `*.refresh_token`, `*.access_token`, headers `authorization`, `cookie`, `x-twilio-signature`, `stripe-signature`.
6. **CORS**: Web origin allowlist only. No `*`.
7. **Rate limiting** at API edge (per-IP + per-user). 60 req/min default, lower for auth endpoints.
8. **No secrets in repo.** `.env.example` has placeholders only. CI scans with `gitleaks`.
9. **JWT verification** uses Supabase JWT secret. We never trust headers without verification.
10. **Twilio number validation**: when handling an inbound webhook for `/webhooks/twilio/sms/:operatorId`, verify that `To` matches the operator's assigned number. Reject mismatches.
11. **Cross-tenant isolation tests** in CI. Every protected endpoint has a test that proves Operator A cannot access Operator B's data.
12. **Outbound SMS recipient allowlisting in non-prod**. Staging will only deliver SMS to a configured allowlist of phone numbers to prevent leaks during testing.
13. **Stripe Connect**: never use `direct_charges` for booking fees. Use destination charges with `transfer_data.destination` so platform retains fraud and refund control.
14. **Caller data minimization**: store only what's needed. Caller phone is required, name is collected by bot, email only if caller volunteers it.
15. **Audit log writes** for: subscription state changes, calendar connect/disconnect, Twilio number assignment, manual appointment cancel, payment refund.
16. **Prompt injection defenses**: caller messages wrapped in delimited blocks; system prompt instructs the model to never execute caller-supplied instructions; tool inputs from the model are zod-validated server-side before execution.
17. **AI output never executed as code or SQL.** Tool args are validated with zod and dispatched to typed handlers.
18. **Supabase RLS regression test** runs in CI on every PR using a separate test project.
19. **Dependency scanning**: `pnpm audit` and Dependabot on. Block merges on high+ severity.
20. **HTTPS only**. HSTS preload. Cookies are `Secure`, `HttpOnly`, `SameSite=Lax`.
21. **Admin authorization** (Slice 15). `AdminGuard` requires `auth.users.app_metadata.role = 'admin'`. `app_metadata` is server-only-writable in Supabase, so operators cannot self-promote. The admin role is also derived locally at JWT-verify time and surfaced on `AuthenticatedUser.isAdmin`. See ADR 0009.
22. **Audit log on every admin write** (Slice 15) — operator deactivation, refunds, subscription cancels, impersonation, force-end, admin promote/demote. Audit failures must NOT block the user action (denial-of-service vector); log loudly instead. `AuditLogService.fromRequest()` captures IP + user-agent for the entry.
23. **Slack — single BookingBlues-team workspace** (Slice 7.5, ADR 0010). The bot token (`SLACK_BOT_TOKEN`) and target channel (`SLACK_DEFAULT_CHANNEL_ID`) live in env vars, not in the database — there is no per-operator OAuth, no `slack_connections` table, no encrypted-token-per-row. `SLACK_SIGNING_SECRET` remains the HMAC secret for inbound webhook signature verification (`X-Slack-Signature` v0 with a 5-minute replay window). The bot token must be redacted in logs (see §11.5 redact paths).

---

## 12. Conversation State Machine

```
       new caller SMS
            |
            v
     [awaiting_bot] --bot reply sent--> [awaiting_caller]
            ^                                  |
            |                                  | caller replies within 24h
            +----------------------------------+
            |                                  |
            |                              no reply 24h
            |                                  |
            |                                  v
            |                            [abandoned]
            |
       tool: book_appointment ok --> [completed, outcome=booked]
       tool: mark_out_of_scope ----> [completed, outcome=out_of_scope]
       tool: mark_spam ------------> [completed, outcome=spam]
       tool: escalate_to_human ----> [escalated]   (NON-TERMINAL — Slice 7.5)
       turn cap reached -----------> [escalated]   (NON-TERMINAL — Slice 7.5)
```

Implementation: enum stored in `conversations.status`. Transitions wrapped in DB transaction. `pg-boss` handles delayed jobs (24h abandonment, 1h reminder, fee timeout).

**`escalated` is non-terminal** (Slice 7.5). When a conversation is `escalated`:
- The AI advance loop **does not** run on new caller SMS; the SMS webhook bridges
  the caller's message to the Slack thread instead.
- An agent can hand control back via `/bb back-to-bot` or the "Resume AI" action
  button on the parent Slack message → status flips to `awaiting_caller` and
  the next caller SMS resumes the advance loop with full transcript history.
- An agent can close via `/bb resolve` / "Close" / "Mark spam" → status flips
  to `completed` with the chosen outcome.
- One open `escalations` row per conversation is enforced by a partial unique
  index (`escalations_one_open_per_conversation`). Re-escalation is fine after
  resolution.

---

## 13. Testing Strategy

- **Unit tests**: every service. Pure logic (slot picking, prompt assembly, fee calculation) covered exhaustively.
- **Integration tests**: webhook handlers using the actual Twilio/Stripe signature math, with mocked HTTP clients for the external APIs.
- **Contract tests**: zod schemas for every external payload we accept; tests use real captured fixtures.
- **RLS tests**: connect with two different anon JWTs and assert row visibility.
- **Cross-tenant isolation tests**: required for any controller touching operator data.
- **End-to-end conversation test**: scripted caller turns + recorded OpenAI responses, walks through book, out-of-scope, spam, payment-link paths.
- **No tests against live Twilio, Stripe, OpenAI, or Google in CI.** All mocked. Manual smoke checklist documented in `apps/api/test/SMOKE.md` and run before each prod deploy.

Coverage target: 80% lines on API, with 100% on webhook signature verification and tool dispatch.

---

## 14. Deployment (Railway)

Two services in one project:
- `api`: builds `apps/api`, runs `node dist/main.js`. Healthcheck `/v1/health`.
- `web`: builds `apps/web`, runs `next start`. Healthcheck `/`.

Separate environments: `production`, `staging`. Staging uses a separate Supabase project, Twilio subaccount, Stripe test mode, Google OAuth client with staging redirect URIs.

Database migrations run as a Railway pre-deploy command on the API service: `pnpm db:migrate`.

Background workers: same Docker image as API, started with `node dist/jobs/worker.js`. Separate Railway service so we can scale independently.

Rollbacks: keep last 3 successful deploys pinned. Migrations forward-only, so data rollbacks are forward-fix only.

---

## 15. Code Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on, `exactOptionalPropertyTypes` on.
- ESLint with `@typescript-eslint`, `eslint-plugin-import`, `eslint-plugin-unicorn`, `eslint-plugin-security`.
- Prettier, single config in `packages/config/prettier`.
- Imports: absolute via `@/` alias, no deep relative imports beyond two levels.
- DTOs are zod schemas in `*.dto.ts`. Inferred types via `z.infer`.
- Errors: throw typed `AppError` subclasses. Global filter maps to RFC 7807. Never throw raw strings.
- Logging: structured, no string concatenation. `logger.info({ operatorId, conversationId }, 'message')`.
- No default exports except where a framework requires (Next.js pages).
- Files: kebab-case. Classes: PascalCase. Vars/functions: camelCase. SQL: snake_case.
- Comments explain *why*, not *what*. If the code needs comments to be readable, refactor first.
- No `any`. If forced, isolate behind a typed wrapper with a comment explaining why.

---

## 16. MVP Scope (what ships first)

In:
- Operator signup, subscription, login.
- Onboarding wizard (5 categories at launch: Plumbing, HVAC, Electrical, Roofing, Garage Door).
- Twilio number provisioning, voice greeting, SMS conversation.
- AI bot booking against Google Calendar.
- Optional booking fee via Stripe Connect Express.
- Confirmation SMS + email.
- Basic dashboard: list of conversations, list of appointments, monthly counts.
- Settings: business hours, fee on/off, disconnect calendar, cancel subscription.

Out (post-MVP, do not build):
- Multi-user/teams per Operator.
- Multiple calendars per Operator.
- Custom AI prompts editable by Operator.
- Outbound campaigns or marketing.
- Mobile app.
- Analytics beyond simple counts.
- Carrier-direct number porting (we will use forwarding only).
- Voice (call-handling) AI. SMS only for MVP.
- White-labeling.

Roadmap order after MVP: dashboard analytics → Operator-editable bot persona → voice AI option → team accounts.

---

## 17. Common Pitfalls and Gotchas

- **Twilio A2P 10DLC**: US SMS requires brand and campaign registration. Build `twilio_numbers` provisioning to attach numbers to the BookingBlues Messaging Service which is registered under our brand. Plan 1 to 3 weeks for initial campaign approval. Until approved, use Twilio toll-free verified for early customers.
- **Carrier conditional forwarding codes vary**. AT&T, Verizon, T-Mobile each differ. Show carrier-specific instructions; detect carrier via Twilio Lookup if possible.
- **Google Calendar timezone bugs**: always pass `timeZone` on event insert. Free/busy queries return UTC. Convert via Operator's timezone in all bot-facing displays.
- **Stripe Connect onboarding is asynchronous.** `charges_enabled` may be false for hours after Operator finishes. Gate fee-collection on the actual flag, not on Operator clicking "I finished".
- **OpenAI tool call hallucinated arguments**: always zod-validate. Reject and re-prompt on failure rather than executing.
- **Race conditions on slot booking**: two simultaneous callers racing for the same 9am Tuesday slot. Postgres advisory lock keyed on `(operator_id, slot_start_iso)` around the `book_appointment` execution.
- **24-hour SMS engagement window**: standard SMS works fine for our use case (always Caller-initiated), but we should still track inbound timestamp and stop sending automated messages 24h after last Caller reply.
- **Phone number normalization**: always store E.164. Use `libphonenumber-js`. Never store user-entered formats.
- **Webhook retries**: Twilio retries on 5xx. Stripe retries on 5xx and on missing 2xx. Make every handler idempotent through `webhook_events`.
- **Stripe test mode vs Connect**: Connect onboarding in test mode requires the test SSN `000-00-0000` and other test values. Document in `apps/api/test/SMOKE.md`.
- **Supabase Auth email links**: redirect URL must be in Supabase allowlist. Update for each environment.
- **OpenAI cost**: log token usage per conversation. If average conversation exceeds $0.10, optimize the prompt before optimizing the model.
- **Trial abuse**: card required at signup is the primary defense. Add secondary checks: rate-limit signups per IP, block disposable email domains, dedupe trials by `personal_phone_e164` (one trial per verified mobile number, lifetime). Implement these checks at signup, not retroactively.
- **MoR boundary**: BookingBlues is explicitly NOT the merchant of record for booking fees. The Operator's connected account is. Do not write code that holds caller funds, schedules transfers, or routes payouts. If a future feature seems to require that, escalate; it likely changes our compliance posture.
- **Direct charges and `Stripe-Account` header**: every Stripe API call related to booking fees must pass the connected account ID, both creating Checkout Sessions and issuing refunds. Wrap the Stripe SDK in a small helper that requires the connected account ID as a typed argument so this can't be forgotten. Calls without the header will succeed against the platform account, charging the wrong entity.
- **Webhook routing for Direct Charges**: payment events for booking fees arrive on the **Connect** endpoint, not the platform endpoint. The event envelope's `account` field identifies which Operator's account. Always cross-reference against `operators.stripe_connect_account_id` before acting.
- **Connected account negative balance**: if a refund happens and the Operator's connected account has insufficient balance, Stripe creates a negative balance recovered from future payouts. Surface this risk in Operator UX before they confirm a cancellation.
- **Statement descriptors**: by default the Operator's business name will appear on caller statements. Verify this in the connected account settings during onboarding so it isn't blank or showing a confusing legal entity.
- **Trial conversion failures are not exceptions**: expect 30 to 50 percent of trials to not convert. Build trial-end handling to be a normal, well-tested path, not an edge case.

---

## 18. Useful References

- Twilio Voice TwiML: https://www.twilio.com/docs/voice/twiml
- Twilio Messaging webhooks: https://www.twilio.com/docs/messaging/guides/webhook-request
- Twilio signature validation: https://www.twilio.com/docs/usage/webhooks/webhooks-security
- Stripe Connect Express: https://stripe.com/docs/connect/express-accounts
- Stripe Checkout for Connect: https://stripe.com/docs/connect/destination-charges
- Stripe webhook signatures: https://stripe.com/docs/webhooks/signatures
- Google Calendar API events: https://developers.google.com/calendar/api/v3/reference/events
- Google OAuth refresh tokens: https://developers.google.com/identity/protocols/oauth2/web-server
- OpenAI tool calling: https://platform.openai.com/docs/guides/function-calling
- Supabase RLS: https://supabase.com/docs/guides/auth/row-level-security
- Railway envs: https://docs.railway.app/develop/variables

---

## 19. ADRs (Architecture Decision Records)

Track significant decisions in `docs/adr/NNNN-title.md`. Initial set:

- 0001 — Monorepo with Turborepo and pnpm.
- 0002 — NestJS for API, Next.js App Router for Web.
- 0003 — Supabase as DB + Auth, RLS as primary AuthZ.
- 0004 — Conversation state in Postgres, not OpenAI threads.
- 0005 — Stripe Connect Express with Direct Charges for booking fees. Operator is merchant of record. Platform takes `application_fee_amount`. No fund holds, no transfers, no MoR exposure for BookingBlues.
- 0006 — pg-boss for queues in MVP, revisit for v2.
- 0007 — SMS-only AI for MVP, no voice AI.
- 0008 — Forward-only migrations, no down migrations.

When a decision in this file changes, write the next ADR and update the relevant section here.
