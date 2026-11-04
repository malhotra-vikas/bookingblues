-- One free trial per person, not per account.
--
-- Every operator that gets a subscription records hashed identifiers: login email
-- (normalized: lowercase, no +tag, Gmail dots removed), personal phone, card
-- fingerprint, Google Calendar email. A new account matching any identifier from
-- another account gets no trial (checkout), or has its trial ended immediately
-- (card / calendar only known after checkout) — see billing/trial-guard.service.ts.
--
-- operator_id is SET NULL on delete, so purging a cancelled operator never
-- re-opens trial eligibility for that person. Values are sha256 hashes; the
-- table is service-role only.

create table public.trial_identities (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email', 'phone', 'card', 'google')),
  value_hash text not null,
  operator_id uuid references public.operators(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint trial_identities_unique unique (kind, value_hash, operator_id)
);

create index trial_identities_hash_idx on public.trial_identities (value_hash);
create index trial_identities_operator_idx on public.trial_identities (operator_id);

alter table public.trial_identities enable row level security;
revoke all on public.trial_identities from anon, authenticated;
