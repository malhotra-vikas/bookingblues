"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readTestEnv = readTestEnv;
exports.describeIfSupabase = describeIfSupabase;
exports.makeServiceClient = makeServiceClient;
exports.setupTenants = setupTenants;
exports.teardownTenants = teardownTenants;
const supabase_js_1 = require("@supabase/supabase-js");
function readTestEnv() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceRoleKey)
        return null;
    return { url, anonKey, serviceRoleKey };
}
function describeIfSupabase(name, body) {
    const env = readTestEnv();
    const fn = env ? describe : describe.skip;
    fn(name, body);
}
function makeServiceClient(env) {
    return (0, supabase_js_1.createClient)(env.url, env.serviceRoleKey, {
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
async function setupTenants(count) {
    const env = readTestEnv();
    if (!env)
        throw new Error('setupTenants requires Supabase env vars');
    const service = makeServiceClient(env);
    const tenants = [];
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
        if (createErr || !created.user)
            throw createErr ?? new Error('failed to create user');
        const userId = created.user.id;
        // Insert an operators row for this user (service role bypasses RLS).
        const { data: op, error: opErr } = await service
            .from('operators')
            .insert({ user_id: userId, business_name: `Test Op ${stamp}` })
            .select('id')
            .single();
        if (opErr || !op)
            throw opErr ?? new Error('failed to create operator');
        // Build an anon-key client and sign in as this user.
        const authedClient = (0, supabase_js_1.createClient)(env.url, env.anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        const { data: signIn, error: signInErr } = await authedClient.auth.signInWithPassword({
            email,
            password,
        });
        if (signInErr || !signIn.session)
            throw signInErr ?? new Error('no session after sign-in');
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
async function teardownTenants(tenants) {
    const env = readTestEnv();
    if (!env)
        return;
    const service = makeServiceClient(env);
    for (const t of tenants) {
        await service.auth.admin.deleteUser(t.userId).catch(() => {
            /* swallow — best effort */
        });
    }
}
//# sourceMappingURL=tenants.js.map