-- 20260623000002_sales_slack_links.sql
--
-- Sales role support (#4). A BB user with app_metadata.role = 'sales' is a sales
-- rep. Leads are still claimed in Slack (#bb-leads), which records
-- lead_claims.claimed_by_slack_user_id. This table links a rep's BB auth account
-- to their Slack identity, so when they log in we can resolve which leads they
-- claimed and let them "login as" those operators (impersonation).
--
-- Admin-managed: an admin promotes a user to 'sales' and sets their slack_user_id
-- here in one step. Service-role only (no anon/authenticated access).

create table if not exists public.sales_slack_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  slack_user_id text not null unique,
  slack_username text,
  created_at timestamptz not null default now()
);

alter table public.sales_slack_links enable row level security;
