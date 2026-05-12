-- Fix 20260511000001_admin_role_helper.sql.
-- The original referenced auth.users.app_metadata, but that's the Supabase
-- SDK/JWT surface name — the underlying column is raw_app_meta_data. The
-- functions errored on first call. Recreate them against the real column.
-- The API still writes via the Supabase admin SDK (admin-write.service.ts)
-- which maps {app_metadata: ...} → raw_app_meta_data automatically; only the
-- direct-SQL helpers needed fixing.

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
  select id, raw_app_meta_data
    into v_user_id, v_existing
    from auth.users
    where email = p_user_email
    limit 1;

  if v_user_id is null then
    raise exception 'admin_promote: no auth.users row with email %', p_user_email;
  end if;

  update auth.users
    set raw_app_meta_data = coalesce(v_existing, '{}'::jsonb)
                            || jsonb_build_object('role', 'admin')
    where id = v_user_id;

  return v_user_id;
end;
$$;

revoke all on function admin_promote(text) from public;

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
  select id, raw_app_meta_data
    into v_user_id, v_existing
    from auth.users
    where email = p_user_email
    limit 1;

  if v_user_id is null then
    raise exception 'admin_demote: no auth.users row with email %', p_user_email;
  end if;

  update auth.users
    set raw_app_meta_data = coalesce(v_existing, '{}'::jsonb) - 'role'
    where id = v_user_id;

  return v_user_id;
end;
$$;

revoke all on function admin_demote(text) from public;
