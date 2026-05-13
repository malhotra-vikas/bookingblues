-- 20260513000001_message_delivery_status.sql
--
-- Outbound-SMS delivery tracking for the #convos Slack thread visual marker.
-- Today we post the bot's reply into Slack as soon as the Twilio API call
-- returns 200 — but 200 only means "queued for the carrier", not "delivered".
-- Real delivery can lag 5–30s on US numbers, more on flaky carriers. The team
-- has been seeing Slack-posts arrive before the SMS lands on the caller's
-- phone, with no signal that the gap is happening.
--
-- Flow: TwilioService.sendSms now sets `statusCallback` so Twilio POSTs us
-- the transition (queued → sent → delivered, or → failed/undelivered). The
-- new webhook updates these columns and edits the Slack message to swap a
-- ⏳ prefix for ✅ on delivered or ❌ on failed (for bot-authored echoes via
-- chat.update; for agent-typed messages we add a reaction since chat.update
-- only works on messages our bot posted).
--
-- For agent-bridged sends, `slack_message_ts` already gets stamped at send
-- time (escalations.service.ts:427); we just need `slack_channel_id` to
-- complete the (channel, ts) pair for chat.update / reactions.add.

alter table public.messages
  add column if not exists delivery_status text not null default 'queued',
  add column if not exists delivered_at timestamptz,
  add column if not exists slack_channel_id text,
  add column if not exists delivery_error_code text;

-- Constrain to the set of states Twilio actually reports plus our initial
-- 'queued' for pre-callback rows. 'unknown' is the fallback when we get a
-- status callback we don't recognize.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_delivery_status_check'
  ) then
    alter table public.messages
      add constraint messages_delivery_status_check
        check (delivery_status in (
          'queued','sent','delivered','failed','undelivered','unknown'
        ));
  end if;
end$$;

-- Status-callback handler looks up by twilio_message_sid (already unique per
-- the init schema). No extra index needed.
