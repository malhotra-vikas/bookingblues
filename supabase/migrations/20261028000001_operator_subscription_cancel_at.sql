-- When a subscription is set to cancel (Customer Portal "cancel at period end",
-- or an admin cancel), Stripe keeps status 'trialing'/'active' until the period
-- ends. Mirror Stripe's `cancel_at` so the dashboard can say "Cancels on …"
-- instead of looking like nothing happened. Null = not scheduled to cancel.
alter table public.operators
  add column if not exists subscription_cancel_at timestamptz;
