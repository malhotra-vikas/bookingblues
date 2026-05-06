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
export declare function readTestEnv(): TestEnv | null;
export declare function describeIfSupabase(name: string, body: () => void): void;
export declare function makeServiceClient(env: TestEnv): SupabaseClient<Database>;
/**
 * Provisions `count` independent operators with their own auth users, returning
 * authenticated clients for each. Each operator gets a unique random email.
 *
 * This is intentionally minimal — Slice 3 (auth + operators) will replace the
 * direct INSERT into `operators` with the real signup flow once it exists.
 */
export declare function setupTenants(count: number): Promise<readonly TestTenant[]>;
/** Best-effort cleanup. Cascades wipe out operators + child rows. */
export declare function teardownTenants(tenants: readonly TestTenant[]): Promise<void>;
//# sourceMappingURL=tenants.d.ts.map