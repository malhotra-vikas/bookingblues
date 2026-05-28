-- Record Terms of Service / Privacy acceptance per operator (ED-21 legal
-- enforceability). The primary, always-present record lives in
-- auth.users.user_metadata (set client-side at signup + re-accept) and drives
-- the middleware re-accept gate. These columns are a server-written
-- denormalised mirror so business-side queries ("who accepted, when, which
-- version") don't have to round-trip the auth admin API.
--
-- Both nullable: operators predating this feature have no recorded
-- acceptance until they next re-accept (the version-bump gate forces that on
-- their next visit to a gated page).

alter table public.operators
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version     text;
