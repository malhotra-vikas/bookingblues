import type { SupabaseService } from '../supabase/supabase.service';

import { JwtVerifierService } from './jwt-verifier.service';

function makeSupabase(getUserResult: { data: { user: unknown } | null; error: unknown | null }): SupabaseService {
  return {
    db: () => ({
      auth: { getUser: jest.fn().mockResolvedValue(getUserResult) },
    }),
  } as unknown as SupabaseService;
}

describe('JwtVerifierService — isAdmin derivation', () => {
  it('sets isAdmin = true when app_metadata.role === "admin"', async () => {
    const svc = new JwtVerifierService(
      makeSupabase({
        data: {
          user: {
            id: 'u1',
            email: 'staff@bb.com',
            app_metadata: { role: 'admin', provider: 'email' },
          },
        },
        error: null,
      }),
    );
    const result = await svc.verify('any.jwt.token');
    expect(result).toEqual({ userId: 'u1', email: 'staff@bb.com', isAdmin: true });
  });

  it('sets isAdmin = false when role is missing', async () => {
    const svc = new JwtVerifierService(
      makeSupabase({
        data: {
          user: {
            id: 'u2',
            email: 'op@bb.com',
            app_metadata: { provider: 'email' },
          },
        },
        error: null,
      }),
    );
    const result = await svc.verify('jwt');
    expect(result.isAdmin).toBe(false);
  });

  it('sets isAdmin = false when role is something other than admin (defense-in-depth)', async () => {
    const svc = new JwtVerifierService(
      makeSupabase({
        data: {
          user: { id: 'u3', email: 'sup@bb.com', app_metadata: { role: 'support' } },
        },
        error: null,
      }),
    );
    const result = await svc.verify('jwt');
    expect(result.isAdmin).toBe(false);
  });

  it('rejects when Supabase returns an error', async () => {
    const svc = new JwtVerifierService(
      makeSupabase({ data: null, error: { message: 'jwt expired' } }),
    );
    await expect(svc.verify('jwt')).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('ignores a user-set role on user_metadata (only app_metadata can promote)', async () => {
    // Defense in depth: a malicious client cannot self-promote by writing
    // user_metadata.role = 'admin'. We only read app_metadata.role.
    const svc = new JwtVerifierService(
      makeSupabase({
        data: {
          user: {
            id: 'u4',
            email: 'attacker@bb.com',
            app_metadata: { provider: 'email' },
            user_metadata: { role: 'admin' },
          },
        },
        error: null,
      }),
    );
    const result = await svc.verify('jwt');
    expect(result.isAdmin).toBe(false);
  });
});
