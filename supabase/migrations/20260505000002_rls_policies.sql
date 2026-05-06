-- RLS policies per CLAUDE.md §8.
-- Default: deny everything. The service role bypasses RLS automatically (Supabase
-- grants it `bypass_rls`), so any policy below applies only to anon/authenticated.

-- ── Helper: resolve current operator id from the JWT ───────────────────────
-- Stable, depends on the operators-table policy below to read its own row, so
-- no SECURITY DEFINER is required (avoids the bypass-RLS footgun).
create or replace function auth_operator_id()
returns uuid
language sql
stable
as $$
  select id from operators where user_id = auth.uid() limit 1
$$;

-- ── operators ──────────────────────────────────────────────────────────────
alter table operators enable row level security;

create policy operators_select_own
  on operators for select
  to authenticated
  using (user_id = auth.uid());

create policy operators_update_own
  on operators for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- INSERT and DELETE are service-role only (no policy => denied for everyone else).

-- ── operator-scoped read tables (authenticated may SELECT only their own) ──
alter table appointments enable row level security;
create policy appointments_select_own
  on appointments for select
  to authenticated
  using (operator_id = auth_operator_id());

alter table conversations enable row level security;
create policy conversations_select_own
  on conversations for select
  to authenticated
  using (operator_id = auth_operator_id());

alter table messages enable row level security;
create policy messages_select_own
  on messages for select
  to authenticated
  using (
    conversation_id in (
      select id from conversations where operator_id = auth_operator_id()
    )
  );

alter table payments enable row level security;
create policy payments_select_own
  on payments for select
  to authenticated
  using (operator_id = auth_operator_id());

alter table calendar_connections enable row level security;
create policy calendar_connections_select_own
  on calendar_connections for select
  to authenticated
  using (operator_id = auth_operator_id());

-- All writes (INSERT/UPDATE/DELETE) on operator-scoped tables go through the API
-- using the service role, which bypasses RLS. No policies for those verbs.

-- ── service-role-only tables ───────────────────────────────────────────────
-- Enabling RLS without any permissive policy = anon/authenticated denied.
alter table webhook_events enable row level security;
alter table audit_log enable row level security;
alter table twilio_numbers enable row level security;
alter table categories enable row level security;
