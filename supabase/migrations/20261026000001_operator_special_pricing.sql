-- Admin-set special pricing for a single operator: "pay $X per month for N
-- months" (or per year for N years) on one plan, then the regular price.
--
-- Implemented in Stripe as a per-operator `duration: repeating` amount-off
-- coupon (special_price_coupon_id). It replaces the Founding Member coupon at
-- checkout, or is attached straight to the live subscription when the operator
-- is already subscribed to the same plan + cadence. These columns are the offer
-- itself, so the operator's dashboard can show it without calling Stripe.
--
-- All-or-nothing: either every column is set (an offer exists) or none are.

alter table public.operators
  add column if not exists special_price_plan      text,
  add column if not exists special_price_cadence   text,
  add column if not exists special_price_cents     integer,
  add column if not exists special_price_periods   integer,
  add column if not exists special_price_coupon_id text,
  add column if not exists special_price_set_at    timestamptz;

alter table public.operators
  drop constraint if exists operators_special_price_check;
alter table public.operators
  add constraint operators_special_price_check check (
    (
      special_price_plan is null
      and special_price_cadence is null
      and special_price_cents is null
      and special_price_periods is null
      and special_price_coupon_id is null
      and special_price_set_at is null
    )
    or (
      special_price_plan in ('solo', 'crew', 'fleet')
      and special_price_cadence in ('monthly', 'annual')
      and special_price_cents >= 0
      and special_price_periods between 1 and 60
      and special_price_coupon_id is not null
      and special_price_set_at is not null
    )
  );
