# Hardening — Phase 0 (Discovery) Findings

**Date:** 2026-05-06 · **Scanned:** local working tree at end of Slice 9 ship.

---

## 1. Deployable surfaces

| Surface | What it is | Deploy target | Status |
|---|---|---|---|
| `apps/api` | NestJS HTTP server (`node dist/main.js` on `:3001`) | Railway → EC2 (Slice 14) | Built through Slice 9 |
| `apps/web` | Next.js 15 App Router (`next start` on `:3000`) | Railway → EC2 | Built through Slice 9 |
| Background workers | Same Docker image as API, separate Railway service per CLAUDE.md §14 | Railway → EC2 | **Not yet built** (pg-boss deferred from Slice 7) |
| Database | Supabase Postgres + Auth | Supabase managed | Live (RLS enforced) |

No mobile / desktop / CLI surfaces. No public-facing URLs yet.

---

## 2. Existing CI

`.github/` does **not exist**. Zero workflows. Zero `dependabot.yml`. Zero `.gitleaks.toml`.

`git remote -v` is empty — repo has **3 local commits, no remote**. Phase 2 will configure both the GitHub remote and the workflow set.

PROGRESS.md "Slice 12: CI gates + security scanning" was the planned home for this; Phase 2 of the hardening pass is the implementation.

---

## 3. Secret inventory

**~35 env vars** declared in `.env.example`, grouped:

| Group | Vars | Storage |
|---|---|---|
| Runtime/URLs (5) | `NODE_ENV`, `LOG_LEVEL`, `APP_URL`, `API_URL`, `PORT` | Local `.env.local` (gitignored ✓) |
| Web (`NEXT_PUBLIC_*`) | 4 — bundled into browser at build time | Local `apps/web/.env.local` (gitignored ✓) |
| Supabase | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | Local + Supabase dashboard |
| Twilio | 5 incl. `OUTBOUND_SMS_ALLOWLIST` | Local + Twilio dashboard |
| OpenAI | `OPENAI_API_KEY` | Local + OpenAI dashboard |
| Stripe | 6 platform + 3 economics (`PLATFORM_TAKE_RATE_BPS`, `MIN_PLATFORM_FEE_CENTS`, `TRIAL_DAYS`) | Local + Stripe dashboard |
| Google OAuth | 3 | Local + Google Cloud Console |
| Email | `RESEND_API_KEY` | Local + Resend dashboard |
| Crypto | `ENCRYPTION_KEY` (versioned, comma-separated for rotation) | Local + ops vault |
| Observability | `SENTRY_DSN_API`, `SENTRY_DSN_WEB` | **Declared but not wired** — Phase 3 todo |

Production storage: not yet — flows to Railway env (Slice 13), then EC2 Secrets Manager (Slice 14). **Phase 4 todo:** document each origin and rotate cadence.

---

## 4. Baseline scans

### `pnpm audit --audit-level=low`

**35 vulnerabilities · 2 critical / 10 high / 15 moderate / 8 low**

🔴 **P0 — BOTH criticals are in `next@15.0.0`:**
1. **GHSA-f82v-jwr5-mffw — Next.js Middleware Authorization Bypass** (>=15.0.0 <15.2.3). **Directly relevant**: Slice 9 built middleware-based auth gating for `/dashboard`, `/onboarding`, `/settings`. This vulnerability lets attackers skip our gating. Patched in 15.2.3.
2. **GHSA-9qr9-h5gf-34mp — Next.js RCE in React flight protocol** (>=14.3.0-canary.77 <15.0.5). Patched in 15.0.5.

**Fix:** bump `next` to ≥15.2.3 (latest minor on the 15.x line). Single-version bump, no API surface change expected. Estimate: 5 min + smoke.

🟠 **High-severity highlights** (10 total — full list via `pnpm audit --audit-level=high`):
- `qs` <6.13.3 (DoS via prototype pollution) — transitive via `@nestjs/platform-express` → `body-parser` → `express`. Fix: bump express/nestjs.
- `@supabase/auth-js` <=2.69.1 (Insecure path routing) — bump to ≥2.70.0.

(Detailed sweep happens in Phase 1 alongside the OWASP walkthrough.)

### Git history secret sweep

Pattern: `(sk_live|sk_test|whsec_|BEGIN PRIVATE KEY|JWT_SECRET\s*=)` over all commits.

- 3 commits scanned. Only match was `SUPABASE_JWT_SECRET=` in `.env.example` with **empty value** (the placeholder line). False positive.
- **No real secrets in history.** Phase 2 will add `gitleaks` to keep it that way.

### `curl -sI` of production URLs

Skipped — **no production deployment yet**. Re-run during Phase 4 against the staging Railway URL once Slice 13 lands.

Local web smoke earlier showed Next.js sends a default `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (good baseline). API has no helmet wired — emits `X-Powered-By: Express` (information disclosure) and no security headers.

---

## 5. Code-level posture (early read — feeds Phase 1)

### ✅ Already strong

- Supabase RLS on every operator-scoped table (migration `20260505000002_rls_policies.sql`)
- Webhook signature verification on Stripe platform + Connect, Twilio voice + SMS
- `webhook_events` idempotency (`unique (source, event_id)` constraint)
- Versioned AES-256-GCM `EncryptionService` (12-byte IV, 16-byte tag, `v<N>:iv_b64:tag_b64:ct_b64` wire format) — Phase 1 will sanity-check IV randomness, tag verification, decrypt-failure shape
- Pino redaction for PII paths (Twilio `From`/`To`/`Body`, `*.refresh_token`, `*.access_token`, auth/Twilio/Stripe headers)
- RFC 7807 `ProblemDetailsFilter` sanitizes unhandled 500s to `"unexpected error"`
- Strict zod (`.strict()`) on every PATCH/POST body
- Bearer auth via `supabase.auth.getUser(token)` — handles current ES256 + legacy HS256 transparently
- Caller-message delimiter wrapping (`<<CALLER_MESSAGE>>...<<END>>`) for prompt-injection defense in AI tool dispatch
- No `bcrypt` in repo — by design: Supabase Auth handles password hashing server-side. Phase 1 will confirm Supabase's bcrypt cost.

### 🟠 Gaps surfaced (Phase 1 will detail)

| # | Gap | CLAUDE.md ref | Severity |
|---|---|---|---|
| G1 | `next@15.0.0` middleware-bypass CVE actively exploitable on `/dashboard`, `/onboarding`, `/settings` | §11 | 🔴 P0 |
| G2 | No rate limiting anywhere — `RateLimitError` class exists, never thrown | §11.7 (60/min default, lower for auth) | 🟠 P1 |
| G3 | No CORS configured — `app.enableCors(...)` not called in `main.ts` | §11.6 (Web origin allowlist only, no `*`) | 🟠 P1 |
| G4 | No `helmet` / security headers on the API | §11.20 (HSTS preload + cookies Secure/HttpOnly/SameSite) | 🟠 P1 |
| G5 | API emits `X-Powered-By: Express` (info disclosure) | — | 🟡 P2 |
| G6 | Zero CI — no `pnpm audit` gate, no Dependabot, no gitleaks, no CodeQL | §11.18, §11.19 | 🔴 P0 (Phase 2) |
| G7 | Sentry env vars declared but **no `Sentry.init`** in either app | §11 + Slice 11 | 🟠 P1 (Phase 3) |
| G8 | Webhook 500s in dev when 3rd-party creds missing — by-design loud-fail, but worth a clean error message in prod | — | 🟢 Info |

---

## Recommended Phase 1 priority (subject to your redirect)

1. **Bump Next.js to ≥15.2.3** — single-version bump kills both criticals. Verify middleware still gates after. (~10 min)
2. **Wire CORS + helmet on API** — 15-line patch in `main.ts`. (~15 min)
3. **Wire `@nestjs/throttler`** — 5/15min on auth-related routes (`/v1/me`, `/v1/operators/me/*` mutations), 60/min default elsewhere, webhooks excluded. (~30 min)
4. **Strip `X-Powered-By`** — `app.disable('x-powered-by')`. (~1 min)
5. Bump `qs`/`@supabase/auth-js`/`express` to land high-severity transitive fixes. (~15 min)
6. Then write `docs/SECURITY_REVIEW.md` with the full Phase 1 report (auth, crypto, OWASP, route-coverage matrix).

---

## Open questions for the human

1. **GitHub remote** — when do you want to push? Phase 2 is where CI lights up, and that needs a remote. Either push now (preferable) or stage Phase 2 locally and push when ready.
2. **Snyk/Dependabot account** — do you already have a Snyk account (free tier)? If not, we'll skip `snyk.yml` for now and rely on `pnpm audit` + Dependabot + CodeQL.
3. **Sentry projects** — are the projects provisioned in your Sentry org? If not, Phase 3 wires the code with no-op-when-empty DSN handling, and we add the DSN later.
4. **Production target for the Phase 4 header curl** — Railway staging URL? Or skip until Slice 14 (EC2)?

Park your answers in a follow-up; we'll start tomorrow with Phase 1.
