-- Slice 7: prevent two active appointments at the same slot for the same
-- operator. Per CLAUDE.md §17, the original spec called for a Postgres
-- advisory lock around `book_appointment`; a partial unique index gives the
-- same guarantee with simpler semantics — concurrent inserts race to the
-- index and the loser sees a 23505 unique violation, which the bot translates
-- into "That slot was just taken — pick another."

create unique index appointments_active_slot_unique
  on appointments(operator_id, scheduled_for_start)
  where status in ('proposed', 'confirmed');
