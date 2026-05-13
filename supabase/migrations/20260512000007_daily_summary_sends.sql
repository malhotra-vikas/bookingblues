-- 20260512000007_daily_summary_sends.sql
--
-- Idempotency key for the daily-summary email. The cron endpoint is hit
-- once a day by an external scheduler (Railway cron, EasyCron, etc.) and
-- iterates all operators. The PK guards against accidental double-sends if
-- the cron retries or the endpoint is hit twice within the same day.

create table if not exists public.daily_summary_sends (
  operator_id uuid not null references public.operators(id) on delete cascade,
  summary_date date not null,
  sent_at timestamptz not null default now(),
  email_id text,
  primary key (operator_id, summary_date)
);

-- Service-role only.
alter table public.daily_summary_sends enable row level security;
