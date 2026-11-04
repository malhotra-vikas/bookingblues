# Sourced by run.sh. Synthetic environment for the release E2E.
#
# Local Supabase only. From .env.local we take exactly two values:
#   STRIPE_SECRET_KEY  — must be a TEST key (sk_test_…), refused otherwise
#   OPENAI_API_KEY     — real model calls, so the insurance prompt is exercised for real
# Twilio is a dummy (outbound SMS blocked by the empty non-prod allowlist).
# Google Calendar, Resend and Slack are faked + captured by fakes.cjs.

export PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"

E2E_API_PORT="${E2E_API_PORT:-3001}"
E2E_WEB_PORT="${E2E_WEB_PORT:-3100}"

_sb_env="$(cd "$REPO_ROOT" && supabase status -o env 2>/dev/null)"
_sb() { printf '%s\n' "$_sb_env" | sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p"; }
export SUPABASE_URL="$(_sb API_URL)"
export SUPABASE_ANON_KEY="$(_sb ANON_KEY)"
export SUPABASE_SERVICE_ROLE_KEY="$(_sb SERVICE_ROLE_KEY)"
export SUPABASE_JWT_SECRET="$(_sb JWT_SECRET)"
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "✗ Refusing: SUPABASE_URL is not the local stack (got '${SUPABASE_URL:-nothing}')." >&2; return 1 ;;
esac

_dotenv() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}$/\1/p" "$REPO_ROOT/.env.local" | head -1; }
export STRIPE_SECRET_KEY="$(_dotenv STRIPE_SECRET_KEY)"
case "$STRIPE_SECRET_KEY" in
  sk_test_*) ;;
  *) echo "✗ Refusing: STRIPE_SECRET_KEY in .env.local is not a test key." >&2; return 1 ;;
esac
# Prefer an explicitly passed key (E2E_OPENAI_API_KEY); .env.local's key may be stale.
export OPENAI_API_KEY="${E2E_OPENAI_API_KEY:-$(_dotenv OPENAI_API_KEY)}"
[[ -n "$OPENAI_API_KEY" ]] || { echo "✗ no OpenAI key (set E2E_OPENAI_API_KEY)" >&2; return 1; }
if [[ "$(curl -s -o /dev/null -w '%{http_code}' https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY")" != 200 ]]; then
  echo "⚠ OpenAI key is rejected by OpenAI — AI-conversation checks will fail (set E2E_OPENAI_API_KEY)." >&2
fi

# Active TEST-mode prices on the BookingBlues Stripe account (same amounts as live).
export STRIPE_PRICE_SOLO_MONTHLY="price_1TxXtlBrlSqhHprpJxAIlRmT"
export STRIPE_PRICE_SOLO_ANNUAL="price_1TxXtlBrlSqhHprphUDQHLny"
export STRIPE_PRICE_CREW_MONTHLY="price_1Tc8QUBrlSqhHprpQF9m5o72"
export STRIPE_PRICE_CREW_ANNUAL="price_1Tc8QqBrlSqhHprp9LrsoHG1"
export STRIPE_PRICE_FLEET_MONTHLY="price_1Tc8RSBrlSqhHprpP8HxqnMv"
export STRIPE_PRICE_FLEET_ANNUAL="price_1Tc8RSBrlSqhHprp8XXA3Knw"
export STRIPE_CONNECT_WEBHOOK_SECRET="whsec_e2e_connect_dummy"
# STRIPE_WEBHOOK_SECRET is set by run.sh from `stripe listen --print-secret`.

export NODE_ENV=development
export LOG_LEVEL=info
export PORT="$E2E_API_PORT"
export APP_URL="http://localhost:$E2E_WEB_PORT"
export API_URL="http://localhost:$E2E_API_PORT"
export ENCRYPTION_KEY="1:e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0e2e0"
export CRON_SHARED_SECRET="e2e_cron_secret"
export TRIAL_DAYS=7
export PROMO_FOUNDING_ENDS_AT="2020-01-01T00:00:00Z"
export ENABLED_CATEGORIES="plumbing,hvac,electrical,roofing,garage_door,insurance"

export TWILIO_ACCOUNT_SID="ACe2e00000000000000000000000000000"
export TWILIO_AUTH_TOKEN="e2e_twilio_auth_token"
export TWILIO_MESSAGING_SERVICE_SID=""
export OUTBOUND_SMS_ALLOWLIST=""
export RESEND_API_KEY="re_e2e_fake"           # fakes.cjs captures, nothing is sent
export EMAIL_FROM="KeeprSteady E2E <e2e@e2e.test>"
export SLACK_BOT_TOKEN="xoxb-e2e-fake"          # fakes.cjs captures, nothing is posted
export SLACK_SIGNING_SECRET="e2e_slack_signing"
export SLACK_DEFAULT_CHANNEL_ID="C_E2E_HITL"
export SLACK_CONVOS_CHANNEL_ID="C_E2E_CONVOS"
export GOOGLE_OAUTH_CLIENT_ID="e2e-google-client"
export GOOGLE_OAUTH_CLIENT_SECRET="e2e-google-secret"
export GOOGLE_OAUTH_REDIRECT_URI="$API_URL/v1/oauth/google/callback"
export SENTRY_DSN_API=""
