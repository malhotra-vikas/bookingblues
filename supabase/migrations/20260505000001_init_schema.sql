-- Initial schema for BookingBlues. Per CLAUDE.md §8.
-- Forward-only. Never edit; add a new migration to revert.

create extension if not exists pgcrypto;       -- gen_random_uuid()

-- ── Helper: updated_at trigger function ────────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Enums ──────────────────────────────────────────────────────────────────
create type subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired'
);

create type twilio_number_status as enum ('available', 'assigned', 'released');

create type conversation_status as enum (
  'active', 'awaiting_caller', 'awaiting_bot', 'completed', 'abandoned', 'escalated'
);

create type conversation_outcome as enum (
  'booked', 'no_show_intent', 'out_of_scope', 'spam', 'rejected', 'timeout'
);

create type message_role as enum ('caller', 'bot', 'system');

create type appointment_status as enum (
  'proposed', 'confirmed', 'cancelled', 'completed', 'no_show'
);

create type appointment_fee_status as enum (
  'none', 'pending', 'paid', 'refunded', 'expired'
);

create type payment_type as enum ('booking_fee');

create type payment_status as enum (
  'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded'
);

create type webhook_source as enum ('twilio', 'stripe', 'stripe_connect', 'google');

create type calendar_provider as enum ('google');

create type calendar_connection_status as enum ('active', 'revoked');

-- ── categories (lookup, seeded in migration 0003) ──────────────────────────
create table categories (
  slug                     text primary key,
  display_name             text not null,
  vetting_questions        jsonb not null default '[]'::jsonb,
  system_prompt_template   text not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create trigger set_updated_at_categories
  before update on categories
  for each row execute function set_updated_at();

-- ── operators ──────────────────────────────────────────────────────────────
create table operators (
  id                                  uuid primary key default gen_random_uuid(),
  user_id                             uuid not null unique
                                        references auth.users(id) on delete cascade,
  business_name                       text not null,
  category                            text references categories(slug) on update cascade,
  trade_metadata                      jsonb not null default '{}'::jsonb,
  personal_phone_e164                 text
                                        check (personal_phone_e164 is null
                                          or personal_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  twilio_number_e164                  text unique
                                        check (twilio_number_e164 is null
                                          or twilio_number_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  twilio_number_sid                   text unique,
  google_calendar_id                  text,
  google_calendar_connected_at        timestamptz,
  booking_fee_enabled                 boolean not null default false,
  booking_fee_cents                   integer
                                        check (booking_fee_cents is null
                                          or booking_fee_cents >= 0),
  stripe_customer_id                  text unique,
  stripe_subscription_id              text unique,
  subscription_status                 subscription_status,
  trial_ends_at                       timestamptz,
  stripe_connect_account_id           text unique,
  stripe_connect_charges_enabled      boolean not null default false,
  stripe_connect_payouts_enabled      boolean not null default false,
  onboarding_completed_at             timestamptz,
  timezone                            text not null default 'America/New_York',
  business_hours                      jsonb not null default '{}'::jsonb,
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  -- Booking fee in cents must be set when fee collection is enabled.
  constraint booking_fee_cents_when_enabled
    check (booking_fee_enabled = false or booking_fee_cents is not null)
);

create trigger set_updated_at_operators
  before update on operators
  for each row execute function set_updated_at();

create index operators_user_id_idx on operators(user_id);
create index operators_subscription_status_idx on operators(subscription_status);

-- ── twilio_numbers (pool of provisioned numbers) ───────────────────────────
create table twilio_numbers (
  id                  uuid primary key default gen_random_uuid(),
  phone_number_e164   text not null unique
                        check (phone_number_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  twilio_sid          text not null unique,
  operator_id         uuid unique
                        references operators(id) on delete set null,
  status              twilio_number_status not null default 'available',
  purchased_at        timestamptz not null default now(),
  released_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger set_updated_at_twilio_numbers
  before update on twilio_numbers
  for each row execute function set_updated_at();

create index twilio_numbers_status_idx on twilio_numbers(status);

-- ── calendar_connections ───────────────────────────────────────────────────
create table calendar_connections (
  id                          uuid primary key default gen_random_uuid(),
  operator_id                 uuid not null unique
                                references operators(id) on delete cascade,
  provider                    calendar_provider not null default 'google',
  -- Versioned ciphertext written by EncryptionService (`v<N>:<iv_b64>:<tag_b64>:<ct_b64>`).
  encrypted_refresh_token     text not null,
  access_token_cache          text,
  access_token_expires_at     timestamptz,
  scopes                      text[] not null default '{}'::text[],
  connected_email             text,
  status                      calendar_connection_status not null default 'active',
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger set_updated_at_calendar_connections
  before update on calendar_connections
  for each row execute function set_updated_at();

-- ── conversations ──────────────────────────────────────────────────────────
create table conversations (
  id                       uuid primary key default gen_random_uuid(),
  operator_id              uuid not null
                             references operators(id) on delete cascade,
  caller_phone_e164        text not null
                             check (caller_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  status                   conversation_status not null default 'awaiting_bot',
  last_message_at          timestamptz,
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  outcome                  conversation_outcome,
  summary                  text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (operator_id, caller_phone_e164, started_at)
);

create trigger set_updated_at_conversations
  before update on conversations
  for each row execute function set_updated_at();

create index conversations_operator_status_idx
  on conversations(operator_id, status);
create index conversations_operator_last_message_idx
  on conversations(operator_id, last_message_at desc nulls last);

-- ── messages ───────────────────────────────────────────────────────────────
create table messages (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null
                           references conversations(id) on delete cascade,
  role                   message_role not null,
  body                   text not null,
  twilio_message_sid     text unique,
  ai_tool_calls          jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger set_updated_at_messages
  before update on messages
  for each row execute function set_updated_at();

create index messages_conversation_created_idx on messages(conversation_id, created_at);

-- ── appointments ───────────────────────────────────────────────────────────
create table appointments (
  id                          uuid primary key default gen_random_uuid(),
  operator_id                 uuid not null
                                references operators(id) on delete cascade,
  conversation_id             uuid
                                references conversations(id) on delete set null,
  caller_phone_e164           text not null
                                check (caller_phone_e164 ~ '^\+[1-9][0-9]{1,14}$'),
  caller_name                 text not null,
  caller_email                text,
  job_summary                 text not null,
  scheduled_for_start         timestamptz not null,
  scheduled_for_end           timestamptz not null,
  google_event_id             text,
  status                      appointment_status not null default 'proposed',
  fee_cents                   integer
                                check (fee_cents is null or fee_cents >= 0),
  fee_status                  appointment_fee_status not null default 'none',
  fee_payment_intent_id       text unique,
  fee_checkout_session_id     text unique,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint scheduled_range_valid
    check (scheduled_for_end > scheduled_for_start)
);

create trigger set_updated_at_appointments
  before update on appointments
  for each row execute function set_updated_at();

create index appointments_operator_start_idx
  on appointments(operator_id, scheduled_for_start);
create index appointments_operator_status_idx
  on appointments(operator_id, status);

-- ── payments ───────────────────────────────────────────────────────────────
create table payments (
  id                                uuid primary key default gen_random_uuid(),
  operator_id                       uuid not null
                                      references operators(id) on delete cascade,
  appointment_id                    uuid not null
                                      references appointments(id) on delete cascade,
  type                              payment_type not null default 'booking_fee',
  -- Denormalized connected-account id (the operator's Stripe Connect account
  -- at the time of charge). Helps audit later if operator's connect account changes.
  stripe_connected_account_id       text not null,
  stripe_payment_intent_id          text not null unique,
  stripe_charge_id                  text unique,
  amount_cents                      integer not null
                                      check (amount_cents >= 0),
  application_fee_cents             integer not null
                                      check (application_fee_cents >= 0),
  currency                          text not null
                                      check (length(currency) = 3),
  status                            payment_status not null default 'pending',
  refunded_at                       timestamptz,
  raw_event                         jsonb,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),
  constraint application_fee_within_amount
    check (application_fee_cents <= amount_cents)
);

create trigger set_updated_at_payments
  before update on payments
  for each row execute function set_updated_at();

create index payments_operator_idx on payments(operator_id);
create index payments_appointment_idx on payments(appointment_id);

-- ── webhook_events (idempotency table — see §11.2) ─────────────────────────
create table webhook_events (
  id                       uuid primary key default gen_random_uuid(),
  source                   webhook_source not null,
  event_id                 text not null,
  signature_verified       boolean not null,
  payload                  jsonb not null,
  processed_at             timestamptz,
  error                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- IDEMPOTENCY KEY: a unique (source, event_id) means a duplicate webhook
  -- delivery from Twilio/Stripe/Google fails the insert and we know to skip it.
  unique (source, event_id)
);

create trigger set_updated_at_webhook_events
  before update on webhook_events
  for each row execute function set_updated_at();

create index webhook_events_processed_at_idx on webhook_events(processed_at);

-- ── audit_log (append-only) ────────────────────────────────────────────────
create table audit_log (
  id               uuid primary key default gen_random_uuid(),
  actor_user_id    uuid references auth.users(id) on delete set null,
  operator_id      uuid references operators(id) on delete set null,
  action           text not null,
  resource_type    text not null,
  resource_id      text,
  metadata         jsonb not null default '{}'::jsonb,
  ip_address       inet,
  user_agent       text,
  created_at       timestamptz not null default now()
);

create index audit_log_operator_created_idx
  on audit_log(operator_id, created_at desc);
create index audit_log_actor_created_idx
  on audit_log(actor_user_id, created_at desc);
create index audit_log_resource_idx
  on audit_log(resource_type, resource_id);
