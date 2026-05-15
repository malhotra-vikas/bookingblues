-- 20260514000001_lowercase_auth_emails.sql
--
-- One-shot backfill: lowercase every `auth.users.email` so future case-
-- insensitive lookups (including signups that re-attempt with different
-- casing) reach the same row. AuthForm.tsx now normalizes at submit time;
-- this catches the rows already in the wild.
--
-- Safety: if BOTH `Foo@x.com` and `foo@x.com` somehow exist, the lowercase
-- update on the mixed-case row would collide with the existing-lowercase
-- row's unique constraint. We skip those collisions and surface the
-- conflicting addresses via a NOTICE so they can be reconciled by hand.
-- Task #45, plumbing-MVP carry-over.

do $$
declare
  conflict_count int;
begin
  -- Report collisions (won't fix automatically — needs human merge).
  select count(*) into conflict_count
  from auth.users u1
  where u1.email is not null
    and u1.email <> lower(u1.email)
    and exists (
      select 1 from auth.users u2
      where u2.id <> u1.id
        and u2.email = lower(u1.email)
    );
  if conflict_count > 0 then
    raise notice
      'Lowercase email collisions detected on % rows. Review with: '
      'select id, email from auth.users where email <> lower(email) '
      'and exists (select 1 from auth.users u2 where u2.id <> auth.users.id '
      'and u2.email = lower(auth.users.email));',
      conflict_count;
  end if;
end$$;

-- Lowercase everything else.
update auth.users
set email = lower(email)
where email is not null
  and email <> lower(email)
  and not exists (
    select 1 from auth.users u2
    where u2.id <> auth.users.id
      and u2.email = lower(auth.users.email)
  );
