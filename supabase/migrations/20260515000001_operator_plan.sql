-- Track which plan/cadence each operator is on, so the dashboard, admin,
-- and reporting can answer "who's on Crew annual" without round-tripping
-- to the Stripe API. Source of truth at billing time remains
-- stripe_price_id (denormalised here from subscription.items[0].price.id)
-- so price-name churn doesn't lose us historical context.
--
-- All three columns are nullable: pre-launch operators in trial without a
-- subscription have nothing to fill in yet, and the billing webhook
-- populates these on subscription.created/updated.

alter table public.operators
  add column if not exists plan          text,
  add column if not exists plan_cadence  text,
  add column if not exists stripe_price_id text;

alter table public.operators
  drop constraint if exists operators_plan_check;
alter table public.operators
  add  constraint operators_plan_check
       check (plan is null or plan in ('solo', 'crew', 'fleet'));

alter table public.operators
  drop constraint if exists operators_plan_cadence_check;
alter table public.operators
  add  constraint operators_plan_cadence_check
       check (plan_cadence is null or plan_cadence in ('monthly', 'annual'));

-- Useful for "how many on each tier" admin queries; cheap because operators
-- table stays small (one row per paying business).
create index if not exists operators_plan_idx on public.operators (plan);
