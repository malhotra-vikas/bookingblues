-- Stripe Checkout (mode=payment) does NOT attach a PaymentIntent id to the
-- Session at creation time — the PI is created when the customer pays. We
-- therefore insert the pending `payments` row WITHOUT a PI id and backfill it
-- from the `payment_intent.succeeded` Connect webhook (matched via the PI's
-- metadata.appointment_id). Relax the NOT NULL accordingly; the unique
-- constraint stays (Postgres permits multiple NULLs).
alter table payments
  alter column stripe_payment_intent_id drop not null;
