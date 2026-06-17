-- 1-hour-before appointment reminder (CLAUDE.md §9.6). `reminder_sent_at` is the
-- idempotency stamp so the reminder cron never double-sends for an appointment.
-- Nullable; existing rows are treated as "not yet reminded" (harmless — only
-- future confirmed appointments are ever in the reminder window).
alter table public.appointments
  add column if not exists reminder_sent_at timestamptz;

-- Supports the cron's hot query: upcoming, confirmed, not-yet-reminded.
create index if not exists appointments_reminder_due_idx
  on public.appointments (scheduled_for_start)
  where reminder_sent_at is null and status = 'confirmed';
