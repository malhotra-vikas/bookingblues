import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@bookingblues/db-types';

/**
 * Test fixtures for cross-tenant isolation (CLAUDE.md §11.11) and RLS regression
 * (§11.18).
 *
 * Usage from an integration test:
 *
 *   const tenants = await setupTenants(2);
 *   try {
 *     // tenants[0].authedClient is logged in as Operator A
 *     // tenants[1].authedClient is logged in as Operator B
 *     // Both use the anon key + a real JWT; service role is on `serviceClient`.
 *     // Assert visibility boundaries on every operator-scoped table.
 *   } finally {
 *     await teardownTenants(tenants);
 *   }
 *
 * These helpers require a live Supabase instance reachable via the env vars
 * below. Tests that use them should be tagged so they're skipped when no
 * SUPABASE_URL is set (see `describeIfSupabase` below).
 */

export interface TestTenant {
  readonly userId: string;
  readonly email: string;
  readonly password: string;
  readonly operatorId: string;
  /** Supabase-issued user access token (HS256 JWT). Use as Bearer in API tests. */
  readonly accessToken: string;
  /** anon-key client authenticated as this user (RLS-enforced). */
  readonly authedClient: SupabaseClient<Database>;
}

export interface TestEnv {
  readonly url: string;
  readonly anonKey: string;
  readonly serviceRoleKey: string;
}

export function readTestEnv(): TestEnv | null {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) return null;
  return { url, anonKey, serviceRoleKey };
}

/**
 * `describe` wrapper that registers the suite normally when a live Supabase
 * is reachable, and `describe.skip`s otherwise. Two gates:
 *   1) SUPABASE_* env vars are present (covers CI without an ephemeral DB).
 *   2) `_SUPABASE_REACHABLE` was set by test/setup-env.ts after a sync probe
 *      of $SUPABASE_URL/auth/v1/health (covers local dev where the env vars
 *      point at 127.0.0.1:54321 but Docker isn't running).
 *
 * Skipping (vs. failing with AuthRetryableFetchError) keeps the VS Code
 * Problems tab clean and signals to readers that these need infra, not code.
 */
export function describeIfSupabase(name: string, body: () => void): void {
  const env = readTestEnv();
  const reachable = process.env._SUPABASE_REACHABLE === '1';
  const fn = env && reachable ? describe : describe.skip;
  fn(name, body);
}

export function makeServiceClient(env: TestEnv): SupabaseClient<Database> {
  return createClient<Database>(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Provisions `count` independent operators with their own auth users, returning
 * authenticated clients for each. Each operator gets a unique random email.
 *
 * This is intentionally minimal — Slice 3 (auth + operators) will replace the
 * direct INSERT into `operators` with the real signup flow once it exists.
 */
export async function setupTenants(count: number): Promise<readonly TestTenant[]> {
  const env = readTestEnv();
  if (!env) throw new Error('setupTenants requires Supabase env vars');
  const service = makeServiceClient(env);

  const tenants: TestTenant[] = [];
  for (let i = 0; i < count; i += 1) {
    const stamp = `${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
    const email = `test_${stamp}@bookingblues.test`;
    const password = `pw_${stamp}_${Math.random().toString(36).slice(2)}`;

    // Create the auth user via the admin API.
    const { data: created, error: createErr } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created.user) throw createErr ?? new Error('failed to create user');
    const userId = created.user.id;

    // Insert an operators row for this user (service role bypasses RLS).
    const { data: op, error: opErr } = await service
      .from('operators')
      .insert({ user_id: userId, business_name: `Test Op ${stamp}` })
      .select('id')
      .single();
    if (opErr || !op) throw opErr ?? new Error('failed to create operator');

    // Build an anon-key client and sign in as this user.
    const authedClient = createClient<Database>(env.url, env.anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: signIn, error: signInErr } = await authedClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInErr || !signIn.session) throw signInErr ?? new Error('no session after sign-in');

    tenants.push({
      userId,
      email,
      password,
      operatorId: op.id,
      accessToken: signIn.session.access_token,
      authedClient,
    });
  }
  return tenants;
}

/** Best-effort cleanup. Cascades wipe out operators + child rows. */
export async function teardownTenants(tenants: readonly TestTenant[]): Promise<void> {
  const env = readTestEnv();
  if (!env) return;
  const service = makeServiceClient(env);
  for (const t of tenants) {
    await service.auth.admin.deleteUser(t.userId).catch(() => {
      /* swallow — best effort */
    });
  }
}
