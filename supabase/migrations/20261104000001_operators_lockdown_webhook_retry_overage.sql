-- Security + billing hardening (docs/AUDIT-2026-11-04.md #1, plus webhook
-- retries and overage-revenue backstops).

-- ── 1. operators: no direct writes from the browser ─────────────────────────
-- `operators_update_own` let an operator PATCH their own row through PostgREST
-- with the anon key + their JWT: subscription_status, plan, Connect flags,
-- overage_unpaid_invoice_id, trial_ends_at, current_period_start, … Every
-- legitimate operator write goes through the API (service role, which bypasses
-- RLS), so the web app loses nothing. SELECT-own stays.
drop policy if exists operators_update_own on public.operators;
-- Belt and braces: with no policy RLS already denies, but drop the table grants
-- too so a future permissive policy can't silently reopen this.
revoke insert, update, delete on public.operators from anon, authenticated;

-- ── 2. webhook_events: failed events are re-claimable ───────────────────────
-- Before: a retry hit the unique (source, event_id) row, was treated as a
-- duplicate and 200'd — so a delivery that failed once was never processed and
-- Stripe stopped retrying. Now an unprocessed row can be re-claimed once its
-- claim lease has lapsed (failures release the lease immediately).
alter table public.webhook_events
  add column attempts integer not null default 1,
  add column claimed_at timestamptz not null default now();

create index webhook_events_unprocessed_idx
  on public.webhook_events (source, created_at)
  where processed_at is null;

-- Atomically claim an already-recorded event for (re)processing.
-- outcome: 'reclaimed' (caller owns it now; id + attempts returned),
--          'processed' (done — ack the delivery),
--          'in_progress' (another worker holds a live claim — ask the sender to retry).
create or replace function public.claim_webhook_event(
  p_source webhook_source,
  p_event_id text,
  p_lease_seconds integer
)
returns table (id uuid, attempts integer, outcome text)
language plpgsql
as $$
#variable_conflict use_column
begin
  return query
    with c as (
      update public.webhook_events w
         set claimed_at = now(),
             attempts = w.attempts + 1
       where w.source = p_source
         and w.event_id = p_event_id
         and w.processed_at is null
         and w.claimed_at < now() - make_interval(secs => p_lease_seconds)
      returning w.id, w.attempts
    )
    select c.id, c.attempts, 'reclaimed'::text from c;
  if found then
    return;
  end if;

  return query
    select w.id,
           w.attempts,
           case when w.processed_at is not null then 'processed' else 'in_progress' end
      from public.webhook_events w
     where w.source = p_source
       and w.event_id = p_event_id;
end;
$$;

-- ── 3. usage: remember the plan each person was counted under ───────────────
-- Overage for a closed window is billed at the plan in force while it filled,
-- even if the operator has since downgraded or cancelled. Null on rows written
-- before this migration → billing falls back to the operator's current plan.
-- `in_trial` marks people counted during the free trial: those windows are
-- never billed, and the flag survives trial_ends_at being cleared on cancel.
alter table public.usage_callers
  add column plan text,
  add column in_trial boolean not null default false;

-- Closed-window candidates for the overage backstop: windows with people in
-- them and no usage_overage_charges row covering their start. The API decides
-- which are actually closed / billable (usage-billing.service.ts).
create or replace function public.usage_unbilled_windows(p_started_before timestamptz)
returns table (operator_id uuid, window_start timestamptz, people integer, plan text, in_trial boolean)
language sql
stable
as $$
  select u.operator_id,
         u.window_start,
         count(*)::integer as people,
         (array_agg(u.plan order by u.created_at desc) filter (where u.plan is not null))[1] as plan,
         bool_or(u.in_trial) as in_trial
    from public.usage_callers u
   where u.window_start < p_started_before
     and not exists (
       select 1
         from public.usage_overage_charges c
        where c.operator_id = u.operator_id
          and c.window_start <= u.window_start
          and u.window_start < c.window_end
     )
   group by u.operator_id, u.window_start
$$;

-- Service-role only (Supabase grants EXECUTE on public functions to anon and
-- authenticated directly — see 20261027000001).
revoke execute on function public.claim_webhook_event(webhook_source, text, integer) from anon, authenticated, public;
revoke execute on function public.usage_unbilled_windows(timestamptz) from anon, authenticated, public;
grant execute on function public.claim_webhook_event(webhook_source, text, integer) to service_role;
grant execute on function public.usage_unbilled_windows(timestamptz) to service_role;
