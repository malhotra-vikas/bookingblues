-- 20260623000003_operator_billing_period.sql
--
-- Usage metering (conversations per billing cycle). To count conversations in
-- the operator's current period — for both trial and paid — we need the period
-- boundaries. Stripe's subscription carries current_period_start/end (during a
-- trial these span the trial window), so we mirror them onto the operator from
-- the subscription webhook. Nullable: operators without a synced subscription
-- fall back to the calendar month in the usage query.

alter table public.operators
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz;
