import { Injectable } from '@nestjs/common';

import { SupabaseService } from '../supabase/supabase.service';
import { UnauthorizedError } from '../errors/app-error';

export interface AuthenticatedUser {
  readonly userId: string;
  readonly email: string | null;
  /**
   * True iff `auth.users.app_metadata.role === 'admin'`. Set server-side via
   * the Supabase Admin SDK; can NEVER be self-assigned because `app_metadata`
   * is not writeable by end-users (in contrast to `user_metadata`).
   * See ADR 0009.
   */
  readonly isAdmin: boolean;
}

/**
 * Verifies Supabase-issued user access tokens by delegating to
 * `supabase.auth.getUser(token)`. Supabase's auth server validates the JWT
 * (handles both HS256 with SUPABASE_JWT_SECRET and the newer asymmetric ES256
 * via JWKS), and returns the canonical user record.
 *
 * Trade-off: one extra HTTP round-trip per authenticated request. Acceptable
 * for MVP; swap to local JWKS verification in `slice 11` (observability) or
 * earlier if latency matters.
 */
@Injectable()
export class JwtVerifierService {
  constructor(private readonly supabase: SupabaseService) {}

  async verify(token: string): Promise<AuthenticatedUser> {
    const { data, error } = await this.supabase.db().auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedError('Invalid or expired token');
    }
    const role = (data.user.app_metadata as { role?: unknown } | undefined)?.role;
    return {
      userId: data.user.id,
      email: data.user.email ?? null,
      isAdmin: role === 'admin',
    };
  }
}
