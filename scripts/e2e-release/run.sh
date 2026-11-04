#!/usr/bin/env zsh
# Release E2E: insurance category + signup + Stripe TEST payments + Solo→Crew→overage
# + usage emails + operator view + admin view + tenant isolation.
#
#   scripts/e2e-release/run.sh          run everything, stop servers afterwards
#   scripts/e2e-release/run.sh --keep   leave API :3001 + stripe listen up (for poking around)
#
# Local Supabase + Stripe TEST mode + real OpenAI. No prod, no real SMS/email/Slack/charges.

set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$REPO_ROOT/scripts/e2e-release"
LOGS="$DIR/.logs"
mkdir -p "$LOGS"
KEEP=0; [[ "${1:-}" == "--keep" ]] && KEEP=1

cd "$REPO_ROOT"
docker info >/dev/null 2>&1 || { echo "✗ Docker is not running."; exit 1; }
supabase status >/dev/null 2>&1 || supabase start >"$LOGS/supabase.log" 2>&1 || { echo "✗ supabase start failed"; exit 1; }
. "$DIR/env.sh" || exit 1
lsof -iTCP:$E2E_API_PORT -sTCP:LISTEN >/dev/null 2>&1 && { echo "✗ Port $E2E_API_PORT is busy."; exit 1; }

API_PID=""; LISTEN_PID=""
cleanup() {
  if (( ! KEEP )); then
    [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null
    [[ -n "$LISTEN_PID" ]] && kill "$LISTEN_PID" 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

# Every migration in the repo must be applied locally.
missing=$(for f in supabase/migrations/*.sql; do v=$(basename "$f" | cut -d_ -f1);
  psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -Atc \
    "select 1 from supabase_migrations.schema_migrations where version='$v'" | grep -q 1 || echo "$v"; done)
[[ -z "$missing" ]] || { echo "✗ Local DB is missing migrations: $missing"; exit 1; }

echo "• building API…"
(cd apps/api && npx nest build) >"$LOGS/api-build.log" 2>&1 || { echo "✗ API build failed ($LOGS/api-build.log)"; exit 1; }

echo "• stripe listen (test mode)…"
export STRIPE_WEBHOOK_SECRET="$(stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret 2>/dev/null)"
[[ "$STRIPE_WEBHOOK_SECRET" == whsec_* ]] || { echo "✗ could not get a stripe listen secret"; exit 1; }
stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to "localhost:$E2E_API_PORT/webhooks/stripe" \
  >"$LOGS/stripe-listen.log" 2>&1 &
LISTEN_PID=$!

export E2E_CAPTURE_FILE="$LOGS/captured.jsonl"
: >"$E2E_CAPTURE_FILE"
echo "• starting API on :$E2E_API_PORT…"
(cd apps/api && exec node --require "$DIR/fakes.cjs" dist/main.js) >"$LOGS/api.log" 2>&1 &
API_PID=$!
for _ in {1..60}; do curl -sf "$API_URL/v1/health" >/dev/null && break; sleep 1; done
curl -sf "$API_URL/v1/health" >/dev/null || { echo "✗ API did not come up ($LOGS/api.log)"; exit 1; }
sleep 3 # let stripe listen finish connecting

echo "• running scenario…"
node "$DIR/release.test.mjs"
STATUS=$?
(( KEEP )) && echo "API still running on :$E2E_API_PORT (pid $API_PID), stripe listen pid $LISTEN_PID"
exit $STATUS
