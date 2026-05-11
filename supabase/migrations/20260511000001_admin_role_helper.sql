-- Slice 15 — first-admin provisioning helper.
-- ADR 0009: admin role lives in auth.users.app_metadata.role.
--
-- This migration provides a SECURITY DEFINER function that lets a superuser
-- (or anything running via service-role) flip a known user_email to admin.
-- After at least one admin exists, the rest are managed via the API
-- (POST /v1/admin/admins, gated by AdminGuard).
--
-- Caller note: app_metadata is merged on update — we DO NOT replace it; we
-- splice in `{role:'admin'}` while preserving anything else Supabase or
-- our own code might write there in the future.

create or replace function admin_promote(p_user_email text)
returns uuid
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_user_id uuid;
  v_existing jsonb;
begin
  select id, app_metadata
    into v_user_id, v_existing
    from auth.users
    where email = p_user_email
    limit 1;

  if v_user_id is null then
    raise exception 'admin_promote: no auth.users row with email %', p_user_email;
  end if;

  update auth.users
    set app_metadata = coalesce(v_existing, '{}'::jsonb)
                       || jsonb_build_object('role', 'admin')
    where id = v_user_id;

  return v_user_id;
end;
$$;

revoke all on function admin_promote(text) from public;
-- service_role implicitly has execute via its bypass; no grant needed.
-- Granting to authenticated would let any logged-in user run it. Don't.

create or replace function admin_demote(p_user_email text)
returns uuid
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  v_user_id uuid;
  v_existing jsonb;
begin
  select id, app_metadata
    into v_user_id, v_existing
    from auth.users
    where email = p_user_email
    limit 1;

  if v_user_id is null then
    raise exception 'admin_demote: no auth.users row with email %', p_user_email;
  end if;

  update auth.users
    set app_metadata = coalesce(v_existing, '{}'::jsonb) - 'role'
    where id = v_user_id;

  return v_user_id;
end;
$$;

revoke all on function admin_demote(text) from public;

-- ── Bootstrap convenience ─────────────────────────────────────────────────
-- Operators promote the first admin manually from the Supabase SQL editor or
-- psql, e.g.
--
--   select admin_promote('vikas@bookingblues.com');
--
-- That returns the user_id. Subsequent admins go through POST /v1/admin/admins
-- which calls these functions via the service-role client.
