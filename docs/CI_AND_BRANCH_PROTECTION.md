# CI & Branch Protection

CI lives in `.github/workflows/ci.yml` and runs on every PR and every push to
`main`. Dependabot (`.github/dependabot.yml`) opens weekly dependency + actions
update PRs.

## Jobs

| Job | Steps | Blocking? |
|---|---|---|
| **build** | install → typecheck → build (api + web) | ✅ typecheck + build block |
| | lint, format:check | ⚠️ report-only (first cut) |
| **audit** | `pnpm audit --audit-level=critical` | ✅ blocks on critical |
| | `pnpm audit --audit-level=high` | ⚠️ report-only until highs remediated |
| **gitleaks** | secret scan over full history (bare binary) | ✅ blocks on findings |

The web build gets placeholder `NEXT_PUBLIC_*` values (it validates them at
module load); they are never deployed. Real values come from Railway.

## Required GitHub secrets

**None** for this first cut — gitleaks uses the bare binary (no token), and there
are no SARIF uploads or third-party scanners yet. CodeQL / Trivy / Snyk and the
Supabase-backed test job are deferred (see the CI remediation task and hardening
Phases 2–5).

## Why these choices

- **corepack, not `pnpm/action-setup`** — the pinned-version action collides with
  the root `packageManager` field (documented footgun). corepack reads
  `packageManager` and provisions the right pnpm.
- **gitleaks bare binary, not `gitleaks-action`** — the action fails on
  Dependabot's read-only token.
- **lint/format report-only** — eslint is declared but the gate isn't yet proven
  repo-clean; surfaced as warnings rather than blocking the first cut.
- **audit blocks on critical, reports high** — there are currently 11 transitive
  high advisories (`form-data <4.0.6` via openai/twilio/axios). Blocking on high
  immediately would wedge CI; we block the worst (critical = 0) and report highs
  until they're remediated, then tighten.

## Branch protection (manual — set in GitHub UI)

Settings → Branches → add a rule for `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass: `build`, `audit`, `gitleaks`
- ✅ Require branches to be up to date before merging
- ✅ Do not allow force pushes / deletions
- (later) Require signed commits — see hardening Phase 2

## Follow-ups (tracked)

1. Confirm `pnpm lint` + `pnpm format:check` pass repo-wide, flip to blocking.
2. Remediate the 11 high advisories, change audit gate to `--audit-level=high`.
3. Add the Supabase-backed test + RLS/cross-tenant job against an **ephemeral**
   test project (never prod) — §11.18, §11.11.
4. Add CodeQL, Trivy (Docker image), and the aggregated security report
   (hardening Phases 2 + 5).
