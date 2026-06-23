-- 20260622000001_sms_consents.sql
--
-- Web SMS opt-in consent log. Backs the public /messaging/opt-in form, which
-- is cited as the consent-collection URL in our A2P 10DLC campaign. Each row is
-- durable proof that a specific person, at a specific time and IP, agreed to
-- the exact disclosure text stored alongside it. Append-only — rows are never
-- updated, so there is no updated_at column or trigger (matches the audit_log
-- convention in CLAUDE.md §8).

create table if not exists public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_e164 text not null,
  trade text,                          -- free-text "what you need", optional
  source text not null default 'web_opt_in',
  consent_version text not null,       -- identifies the disclosure wording agreed to
  consent_text text not null,          -- the exact disclosure shown to + agreed by the user
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Reconcile prior consent / opt-out by phone.
create index if not exists sms_consents_phone_idx on public.sms_consents (phone_e164);

-- Service-role only: the API inserts these after validating the POST. RLS on
-- with no policies = default deny for anon/authenticated roles (consent PII,
-- CLAUDE.md §8).
alter table public.sms_consents enable row level security;
