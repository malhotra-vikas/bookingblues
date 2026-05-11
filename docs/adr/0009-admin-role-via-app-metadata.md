# ADR 0009 — Admin role stored in Supabase `app_metadata.role`

**Status**: Accepted (2026-05-11)
**Slice**: 15 (Internal admin dashboard)
**Supersedes**: n/a

---

## Context

Slice 15 (CLAUDE.md §16 follow-up; PROGRESS.md "Internal admin dashboard") needs
a way to identify BookingBlues *staff* — distinct from Operators and from
Operators' future team members. Staff need to read every Operator's data, issue
refunds, force-end conversations, release Twilio numbers, and impersonate.

Two options were on the table:

1. **`auth.users.app_metadata.role = 'admin'`** — a column-style flag on the
   user record, exposed in the JWT.
2. **Separate `admin_users` table** keyed on `user_id`, joined on every admin
   request.

## Decision

We store the admin flag in **`auth.users.app_metadata.role = 'admin'`**.

`isAdmin` is derived at JWT-verify time
(`apps/api/src/common/auth/jwt-verifier.service.ts`) and surfaced on
`AuthenticatedUser`. `AdminGuard` reads it and 403s when absent.

Promotion to admin happens via a SECURITY DEFINER SQL function
(`admin_promote(user_email text)`) that only superusers / service-role can call,
and via an admin-only endpoint `POST /v1/admin/admins` once at least one admin
exists.

## Why this over a separate table

- **`app_metadata` is server-only writable.** The Supabase docs are explicit:
  end-users can update `user_metadata` but never `app_metadata`. An Operator
  cannot self-promote even if they tamper with the client. The JWT signing flow
  inherits this guarantee — we don't need additional row-level enforcement.
- **One source of truth.** Authoritative on `auth.users`, propagated to every
  JWT issued by Supabase, no join required to make an authorization decision.
- **Cheap.** No round-trip to Postgres on every admin route; the role lives in
  the verified token payload (in practice `supabase.auth.getUser` still hits
  Supabase, but no extra hop on top of what we already do).
- **Audit-friendly.** Every admin action writes `audit_log` with
  `actor_user_id`. We don't need a separate `admin_users.id`.

## Why not a separate `admin_users` table

- Adds a join on every admin request, with no benefit we couldn't get from
  `app_metadata`.
- Creates a second source of truth (the auth user vs. the admin user) that has
  to be kept in sync (deletion cascade, audit, etc.).
- Doesn't add real expressive power — we don't need per-admin scopes or roles
  yet; if we ever do, we can extend `app_metadata` (`{ role: 'admin', scopes:
  [...] }`) without a schema migration.

## Constraints this assumes

- We will **never** allow client-side `updateUser({ data: { role: 'admin' } })`
  to escalate privilege. We rely on Supabase's documented split between
  `app_metadata` (server-only) and `user_metadata` (user-writable). Document
  this constraint in CLAUDE.md §11.
- The role claim flows through `supabase.auth.getUser` server-side. If a future
  perf push moves us to local JWKS verification, the `app_metadata.role` claim
  must still be present in the access token payload (it is, by default).

## Consequences

- Existing `JwtVerifierService` reads `data.user.app_metadata.role`. Any future
  role needs (`role: 'support'`, `role: 'finance'`) extend the same field
  without schema changes.
- The first admin is bootstrapped via `admin_promote(text)` (migration 0008
  for Slice 15). After that, an admin promotes others through the API.
- An admin's `user_id` may not have a row in `operators`. Admin guards must not
  call `auth_operator_id()` or assume an operator exists.

## References

- CLAUDE.md §8 (audit_log already exists, every admin write goes through it)
- CLAUDE.md §11.15 (audit log discipline)
- PROGRESS.md "Slice 15"
- Supabase Auth docs — App vs. User Metadata
