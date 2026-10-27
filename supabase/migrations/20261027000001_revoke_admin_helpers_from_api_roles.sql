-- SECURITY FIX: admin_promote / admin_demote are SECURITY DEFINER helpers meant
-- for the SQL editor only. The earlier migrations revoked EXECUTE from PUBLIC,
-- but Supabase grants EXECUTE on public-schema functions to `anon` and
-- `authenticated` directly, so those grants survived. Result: anyone holding
-- the public anon key could call POST /rest/v1/rpc/admin_promote with any email
-- and make that account an admin. Confirmed on prod 2026-10-27 (the function
-- body ran for an anonymous caller).
--
-- The API never calls these via RPC (admin promote/demote goes through the
-- Supabase admin SDK with the service role), so nothing in the app depends on
-- these grants. service_role and postgres keep EXECUTE.

revoke execute on function public.admin_promote(text) from anon, authenticated, public;
revoke execute on function public.admin_demote(text)  from anon, authenticated, public;

grant execute on function public.admin_promote(text) to service_role;
grant execute on function public.admin_demote(text)  to service_role;
