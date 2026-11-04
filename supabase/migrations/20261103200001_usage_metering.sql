-- Usage metering + enforcement (plan limits).
--
-- A plan's limit is the number of UNIQUE people (caller phone numbers) the AI
-- talks to per monthly usage window: Solo 80, Crew 500, Fleet 1500. The window
-- is anchored on the operator's billing period start (see usage-window.ts).
-- Solo blocks new people at the limit; Crew/Fleet pay $15 per started batch of
-- 50 extra people. Operator + admins are emailed at 80% and 100%.

-- One row per person the AI engaged in a window. The unique key IS the counter:
-- count(*) per (operator_id, window_start) = people used.
create table public.usage_callers (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  window_start timestamptz not null,
  caller_phone_e164 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operator_id, window_start, caller_phone_e164)
);

-- Dedupe for the 80% / 100% emails: one send per threshold per window.
create table public.usage_alerts (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  window_start timestamptz not null,
  threshold_pct smallint not null check (threshold_pct in (80, 100)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operator_id, window_start, threshold_pct)
);

-- One row per closed window we evaluated for overage (Crew/Fleet). Also the
-- idempotency claim, so a window is never billed twice.
create table public.usage_overage_charges (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  window_start timestamptz not null,
  window_end timestamptz not null,
  people_used integer not null,
  people_included integer not null,
  batches integer not null,
  amount_cents integer not null,
  -- 'none' = under the limit; 'pending' = claimed, Stripe not done yet;
  -- 'invoiced' = on an invoice; 'paid' / 'failed' = standalone overage invoice result.
  status text not null check (status in ('none', 'pending', 'invoiced', 'paid', 'failed')),
  stripe_invoice_id text,
  stripe_invoice_item_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operator_id, window_start)
);
create index usage_overage_charges_invoice_idx on public.usage_overage_charges (stripe_invoice_id);

-- Annual Crew/Fleet overage is charged on its own invoice. While one is unpaid
-- the AI is paused (same degraded mode as past_due). Null = nothing owed.
alter table public.operators add column overage_unpaid_invoice_id text;

create trigger set_usage_callers_updated_at
  before update on public.usage_callers
  for each row execute function set_updated_at();
create trigger set_usage_alerts_updated_at
  before update on public.usage_alerts
  for each row execute function set_updated_at();
create trigger set_usage_overage_charges_updated_at
  before update on public.usage_overage_charges
  for each row execute function set_updated_at();

-- RLS: operators may read their own rows; all writes go through the API's
-- service role.
alter table public.usage_callers enable row level security;
alter table public.usage_alerts enable row level security;
alter table public.usage_overage_charges enable row level security;

create policy usage_callers_select_own on public.usage_callers
  for select to authenticated
  using (operator_id = auth_operator_id());
create policy usage_alerts_select_own on public.usage_alerts
  for select to authenticated
  using (operator_id = auth_operator_id());
create policy usage_overage_charges_select_own on public.usage_overage_charges
  for select to authenticated
  using (operator_id = auth_operator_id());
