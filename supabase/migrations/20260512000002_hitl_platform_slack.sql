-- Slice 7.5 follow-up — pivot HITL Slack to a single BookingBlues-team workspace.
-- ADR 0010: the operators are solo trades; the humans in the HITL loop are the
-- BB internal team. We don't need per-operator OAuth installs — one workspace,
-- one bot token (env var), one channel (env var). All operators' escalations
-- post into the same channel with operator + business name in the header so
-- triage staff can route mentally.
--
-- Drops the per-operator install table. The `escalations` table is unchanged —
-- its slack_channel_id / slack_thread_ts columns still pin where each thread
-- lives; we just stop using slack_connections to look that up.

drop table if exists slack_connections;
