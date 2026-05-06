# Resume After Restart

Quick-start brief for the next session. Read this first, then `docs/PROGRESS.md` for full detail.

**Updated at end-of-day** when the user marks the day as done.

---

## Last session

- **Date**: 2026-05-05
- **Last shipped**: Slice 2 — Database foundations (migrations 0001/0002/0003, `SupabaseService`, `WebhookIdempotencyService`, RLS test scaffold)
- **Also today**: established the resume-after-restart workflow (this file)
- **In flight**: nothing — clean checkpoint
- **Repo state**: typecheck clean · 11 passed + 3 skipped tests · `nest build` succeeds · `/v1/health` responds

## Tomorrow's startup checklist

```bash
# 1. Get Docker installed (Docker Desktop for Mac)

# 2. Set up local env
cp .env.example .env.local
# fill in: ENCRYPTION_KEY (run: node -e "console.log('1:'+require('crypto').randomBytes(32).toString('hex'))")
# leave the rest blank for now — they're optional in dev

# 3. Boot local Supabase (after Docker is running)
supabase start
# It prints SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
# Paste those four into .env.local

# 4. Apply migrations + seed
supabase db reset

# 5. Generate real db types (replaces the hand-written stub)
pnpm gen:db

# 6. Verify
pnpm typecheck
pnpm test
pnpm dev   # api on :3001, web on :3000
curl localhost:3001/v1/health

# 7. Run the RLS regression suite against live DB (currently auto-skipped)
pnpm --filter @bookingblues/api test
# the rls.spec.ts cases will activate automatically once SUPABASE_* env vars are present
```

Once that's green, say **"continue"** or **"slice 3"** and we pick up from PROGRESS.md.

## Pick up here

**Slice 3 — Auth + operators** (per `docs/PROGRESS.md`):

1. Supabase JWT verification guard (`apps/api/src/common/auth/`)
2. `GET /v1/me`, `PATCH /v1/me`
3. `operators` module — profile read/write; settings: hours, timezone, fee config
4. `GET/PATCH /v1/operators/me`, `GET /v1/operators/me/onboarding-status`
5. Cross-tenant isolation tests for every operator-scoped controller (per CLAUDE.md §11.11)

## Open questions / blockers

- Docker not installed locally → `pnpm gen:db` and live RLS tests still deferred. The checklist above clears this.

## Notes for next session

- `packages/db-types/src/database.types.ts` is still the hand-written Slice 2 stub. Step 5 of the checklist replaces it wholesale.
- RLS regression tests in `apps/api/test/rls.spec.ts` are gated by `describeIfSupabase` — they auto-enable once Supabase env vars are present (step 3).
