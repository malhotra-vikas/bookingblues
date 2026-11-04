-- Usage alerts are "one email per threshold per window" — but per LIMIT too.
-- An operator who hits Solo 80%/100% and upgrades to Crew mid-window must still
-- get the Crew 80%/100% emails (Crew's 100% is where overage charges start); the
-- old (operator, window, threshold) key swallowed them (release E2E 2026-11-04).
-- Existing rows get limit_people = 0, so they never block a new alert.

alter table public.usage_alerts
  add column limit_people integer not null default 0;

alter table public.usage_alerts
  drop constraint usage_alerts_operator_id_window_start_threshold_pct_key;

alter table public.usage_alerts
  add constraint usage_alerts_operator_window_threshold_limit_key
  unique (operator_id, window_start, threshold_pct, limit_people);
