-- 20260512000006_advance_lock.sql
--
-- Cross-process advance mutex. The AdvanceSchedulerService uses an
-- in-memory debounce to collapse SMS bursts into one OpenAI call. That
-- works on a single replica but not across replicas (Railway autoscale,
-- rolling deploy overlap). This column gives advance.service.ts an atomic
-- "claim the work" gate so at most one replica advances a given
-- conversation at a time.
--
-- Semantics:
--   - `advance_locked_until > now()` → someone holds the lock; skip.
--   - `advance_locked_until is null` OR `<= now()` → up for grabs;
--     conditional UPDATE atomically claims it.
--   - Released by setting back to NULL after advance finishes (or after
--     the TTL expires if the holder crashes).

alter table public.conversations
  add column if not exists advance_locked_until timestamptz;
