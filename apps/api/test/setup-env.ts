import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { config } from 'dotenv';

config({ path: resolve(__dirname, '../../../.env.local') });
config({ path: resolve(__dirname, '../../../.env') });

// Probe local Supabase reachability once per worker so the integration specs
// (cross-tenant, rls, stripe-webhook, twilio-webhook) can `describe.skip`
// themselves cleanly when Docker isn't running. Without this, every test in
// those suites fails identically with `AuthRetryableFetchError: fetch failed`,
// flooding VS Code's Problems tab with ~25 false reds.
//
// Exit code 0 from curl means the server returned ANY HTTP response (incl.
// 404), which is sufficient evidence that Supabase is up. Connection refused
// or timeout (Docker off) yields non-zero and we leave the flag unset.
//
// Local only: .env.local points SUPABASE_URL at the PRODUCTION project, and
// these specs create users and write webhook_events with the service role. A
// remote URL is skipped unless INTEGRATION_ALLOW_REMOTE=1 is set explicitly.
function isLocalUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function probeSupabase(): boolean {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return false;
  if (!isLocalUrl(url) && process.env.INTEGRATION_ALLOW_REMOTE !== '1') return false;
  try {
    execSync(
      `curl -s -o /dev/null --connect-timeout 1 --max-time 2 "${url}/auth/v1/health"`,
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

if (probeSupabase()) {
  process.env._SUPABASE_REACHABLE = '1';
}
