-- Emergency charges (17b/c/d):
-- 1. Operators may opt in to allowing the AI to BOOK without taking payment in
--    immediate-danger situations (gas/CO/sparks/active flooding) so the tech can
--    rush out and collect on site. Off by default — most operators still want
--    the deposit + emergency fee collected up front.
alter table operators
  add column if not exists allow_unpaid_emergency_booking boolean not null default false;

-- 2. Flag an appointment whose fee was NOT collected at booking time (the unpaid
--    immediate-danger path). The tech must collect on site; surfaced on the
--    dashboard and the calendar invite. `fee_cents` still holds the amount owed.
alter table appointments
  add column if not exists collect_payment_on_site boolean not null default false;
