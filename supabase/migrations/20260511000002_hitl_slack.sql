-- Slice 7.5 — Human-in-the-loop via Slack. Forward-only.
-- PROGRESS.md §"Slice 7.5", CLAUDE.md §9.3 / §11 / §12.

-- ── webhook_source: add 'slack' to the enum ────────────────────────────────
alter type webhook_source add value if not exists 'slack';

-- ── slack_connections (per-operator install) ───────────────────────────────
create table slack_connections (
  id                          uuid primary key default gen_random_uuid(),
  operator_id                 uuid not null unique
                                references operators(id) on delete cascade,
  team_id                     text not null,
  team_name                   text,
  default_channel_id          text,
  default_channel_name        text,
  -- AES-256-GCM (versioned) bot token. Wire format matches calendar_connections.
  encrypted_bot_token         text not null,
  scopes                      text[] not null default '{}'::text[],
  installed_at                timestamptz not null default now(),
  installed_by_user_id        uuid references auth.users(id) on delete set null,
  status                      text not null default 'active'
                                check (status in ('active', 'revoked', 'disabled')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger set_updated_at_slack_connections
  before update on slack_connections
  for each row execute function set_updated_at();

create index slack_connections_team_idx on slack_connections(team_id);

-- RLS — service-role only (no policy = anon/authenticated denied).
alter table slack_connections enable row level security;

-- ── escalations (HITL state) ───────────────────────────────────────────────
create type escalation_reason as enum (
  'bot_stuck', 'caller_requested', 'operator_forced', 'calendar_revoked', 'turn_cap'
);
create type escalation_status as enum ('open', 'resolved', 'abandoned');
create type escalation_opener as enum ('bot', 'caller', 'operator');

create table escalations (
  id                     uuid primary key default gen_random_uuid(),
  operator_id            uuid not null
                           references operators(id) on delete cascade,
  conversation_id        uuid not null unique
                           references conversations(id) on delete cascade,
  caller_phone_e164      text not null,
  slack_channel_id       text,
  slack_thread_ts        text,
  reason                 escalation_reason not null,
  status                 escalation_status not null default 'open',
  opened_by              escalation_opener not null,
  resolved_by_user_id    uuid references auth.users(id) on delete set null,
  resolution_note        text,
  fallback_email_sent_at timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  resolved_at            timestamptz
);

create trigger set_updated_at_escalations
  before update on escalations
  for each row execute function set_updated_at();

-- One *open* escalation per conversation. The partial unique index lets a
-- conversation be re-escalated after a prior one closes.
create unique index escalations_one_open_per_conversation
  on escalations(conversation_id) where status = 'open';
create index escalations_operator_status_idx on escalations(operator_id, status);
create index escalations_thread_idx on escalations(slack_channel_id, slack_thread_ts);

alter table escalations enable row level security;

create policy escalations_select_own
  on escalations for select
  to authenticated
  using (operator_id = auth_operator_id());

-- ── messages.slack_message_ts (for bridging) ───────────────────────────────
alter table messages add column slack_message_ts text;
-- A message originating from Slack is identified by a non-null slack_message_ts.
-- We don't make it unique because Slack uses the same ts when an agent edits.
create index messages_slack_message_ts_idx on messages(slack_message_ts)
  where slack_message_ts is not null;
