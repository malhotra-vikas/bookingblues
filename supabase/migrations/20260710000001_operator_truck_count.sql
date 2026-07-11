-- Multi-truck capacity: an operator can service up to `truck_count` appointments
-- concurrently. Default 1 preserves single-truck behavior. Availability + booking
-- enforce N concurrent jobs with a travel buffer between same-truck appointments
-- (BookingsService capacity logic).
alter table public.operators
  add column if not exists truck_count integer not null default 1;

alter table public.operators
  add constraint operators_truck_count_range check (truck_count between 1 and 50);

-- The exact-start unique index blocked legitimate multi-truck bookings at the
-- same time. Capacity is now enforced in the application layer
-- (BookingsService.assertSlotBookable → hasCapacity). Drop the hard guard.
drop index if exists appointments_active_slot_unique;
