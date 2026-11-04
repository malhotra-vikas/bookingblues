import { describeIfSupabase, setupTenants, teardownTenants } from './helpers/tenants';
import type { TestTenant } from './helpers/tenants';

/**
 * RLS regression suite — CLAUDE.md §11.18.
 * Skipped automatically when SUPABASE_* env vars are absent (e.g. in basic CI
 * without an ephemeral Supabase project). Once Slice 12 wires up an ephemeral
 * Supabase test project in CI, these run on every PR.
 */
describeIfSupabase('RLS — operator-scoped tables', () => {
  let tenants: readonly TestTenant[] = [];

  beforeAll(async () => {
    tenants = await setupTenants(2);
  });

  afterAll(async () => {
    await teardownTenants(tenants);
  });

  it('a user can SELECT their own operators row', async () => {
    const [a] = tenants;
    if (!a) throw new Error('tenants not initialized');
    const { data, error } = await a.authedClient
      .from('operators')
      .select('id')
      .eq('id', a.operatorId)
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBe(a.operatorId);
  });

  it("a user CANNOT SELECT another operator's row", async () => {
    const [a, b] = tenants;
    if (!a || !b) throw new Error('tenants not initialized');
    const { data, error } = await a.authedClient
      .from('operators')
      .select('id')
      .eq('id', b.operatorId)
      .maybeSingle();
    // RLS-filtered rows are silently invisible — no error, just no data.
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  // AUDIT-2026-11-04 #1: an operator could PATCH their own billing state
  // (subscription_status, plan, overage pause, …) straight through PostgREST.
  it('a user CANNOT UPDATE their own operators row (all writes go through the API)', async () => {
    const [a] = tenants;
    if (!a) throw new Error('tenants not initialized');
    const before = await a.authedClient
      .from('operators')
      .select('subscription_status, plan')
      .eq('id', a.operatorId)
      .single();
    expect(before.error).toBeNull();

    const { data } = await a.authedClient
      .from('operators')
      .update({ subscription_status: 'active', plan: null, overage_unpaid_invoice_id: null })
      .eq('id', a.operatorId)
      .select('id');
    // Denied either outright (no UPDATE grant) or by RLS (zero rows) — never applied.
    expect(data ?? []).toEqual([]);

    const after = await a.authedClient
      .from('operators')
      .select('subscription_status, plan')
      .eq('id', a.operatorId)
      .single();
    expect(after.data).toEqual(before.data);
  });

  it('webhook_events is invisible to authenticated users', async () => {
    const [a] = tenants;
    if (!a) throw new Error('tenants not initialized');
    const { data, error } = await a.authedClient.from('webhook_events').select('id');
    // Either an explicit denial or an empty set — both prove invisibility.
    if (error) {
      expect(error.code).toBeDefined();
    } else {
      expect(data).toEqual([]);
    }
  });
});
