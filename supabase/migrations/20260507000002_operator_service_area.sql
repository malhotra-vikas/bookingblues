-- Service-area scoping. The AI checks the caller's address ZIP against this
-- list during qualification — out-of-area requests get a polite handoff via
-- mark_out_of_scope rather than a wasted booking and a no-show.
--
-- Empty array = "covers any address" (don't gate). That's the right default
-- for first-day operators who haven't set their area yet.

alter table operators
  add column service_zip_codes text[] not null default '{}';

-- Index covers @> and = lookups; useful for the future admin dashboard
-- (Slice 15) when filtering operators by area.
create index operators_service_zip_codes_gin
  on operators using gin (service_zip_codes);
