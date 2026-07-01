-- Per-operator configurable appointment/visit length (minutes). Default 60
-- preserves the prior hardcoded behavior; the AI prompt, the Slack manual-book
-- modal, and slot math read this instead of a literal 60.
alter table public.operators
  add column if not exists visit_duration_min integer not null default 60;

alter table public.operators
  add constraint operators_visit_duration_min_range
  check (visit_duration_min between 15 and 480);
