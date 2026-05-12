-- Slice 7.5 follow-up — full conversation monitoring in Slack.
-- ADR 0010 amendment: every conversation gets a monitoring thread in
-- SLACK_CONVOS_CHANNEL_ID, independent of any escalation row. The escalations
-- table still owns alarm-and-buttons in SLACK_DEFAULT_CHANNEL_ID (#hitl), but
-- the conversation thread is the source-of-truth transcript surface and
-- supports two-way agent intervention from the start of the call.
--
-- These two columns are nullable because:
--   * Existing rows pre-date this feature.
--   * If SLACK_CONVOS_CHANNEL_ID is unset or the post fails, the conversation
--     still runs (fail-soft, same posture as the email-fallback path).

alter table conversations
  add column slack_channel_id text,
  add column slack_thread_ts  text;

-- Look up a conversation by its Slack thread when an agent reply event comes
-- in. The pair is naturally unique per Slack (channel, ts) but we don't add
-- a unique index — Slack may rate-limit and we could end up with two threads
-- in rare edge cases; the index would block instead of degrading gracefully.
create index conversations_slack_thread_idx
  on conversations (slack_channel_id, slack_thread_ts)
  where slack_thread_ts is not null;
