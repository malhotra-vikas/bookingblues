-- Emergency visit fee (#17e). An optional surcharge the operator sets, charged
-- to the caller IN ADDITION to the booking deposit when a job is an emergency.
-- The platform take rate applies to it the same way as the deposit (on top,
-- caller-paid). Null = not configured. Cents, non-negative.
alter table public.operators
  add column emergency_visit_fee_cents integer
    check (emergency_visit_fee_cents is null or emergency_visit_fee_cents >= 0);

comment on column public.operators.emergency_visit_fee_cents is
  'Optional emergency surcharge (cents) added to the deposit base on emergency bookings; platform take applies. Null = not set.';
