-- 20260512000004_lead_claims.sql
--
-- Sales-team lead ownership. When a new signup posts to #bb-leads, a Slack
-- agent can click "Claim" to take ownership; that writes a row here keyed on
-- auth.users.id. Admin UI surfaces who owns each lead so the team can divide
-- onboarding work without stepping on each other.
--
-- Slack identity is opaque (Slack user id `U…` + display name snapshot). Not
-- joined to anything in BB — these are sales-team Slack members, not BB
-- operators.

create table if not exists public.lead_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  claimed_by_slack_user_id text not null,
  claimed_by_slack_username text,
  claimed_at timestamptz not null default now(),
  claim_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Service-role only — admin write path mutates this directly, RLS off the
-- table prevents accidental anon/authenticated access.
alter table public.lead_claims enable row level security;

-- updated_at trigger to match the convention from §8.
create trigger set_lead_claims_updated_at
  before update on public.lead_claims
  for each row execute function set_updated_at();
