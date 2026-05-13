-- 20260512000005_heal_drifted_escalated_conversations.sql
--
-- One-shot backfill: conversations whose status is 'escalated' but which
-- have NO open escalation row drift into a state where the AI never replies
-- (advance gate) but Twilio still appends inbound SMS. Heal them by
-- flipping back to 'awaiting_caller' so the next caller turn resumes the AI.
--
-- See advance.service.ts — the same heal runs at request time for any new
-- drift, but this catches the rows already in the wild before that fix
-- shipped.

update public.conversations c
set status = 'awaiting_caller', updated_at = now()
where c.status = 'escalated'
  and not exists (
    select 1
    from public.escalations e
    where e.conversation_id = c.id
      and e.status = 'open'
  );
