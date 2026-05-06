import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@bookingblues/db-types';

import { ENV_TOKEN } from '../../config/config.module';
import type { Env } from '../../config/env';
import { AppError } from '../errors/app-error';

/**
 * Service-role Supabase client. **API-only** — never imported by `apps/web`.
 *
 * Per CLAUDE.md §7 / §11.3:
 *   - Service role bypasses RLS. Use it only after the API has done its own
 *     authorization check (JWT + operator scope guards).
 *   - We disable session/refresh-token persistence — this is a server context.
 *
 * The constructor is tolerant of missing credentials in dev so the API can
 * boot for non-DB work (health checks, schema introspection). Any actual call
 * to `db()` without configured credentials throws `supabase.no_credentials`.
 * In production, env validation already requires both vars.
 */
@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient<Database> | null;

  constructor(@Inject(ENV_TOKEN) env: Env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      this.client = null;
      return;
    }
    this.client = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: { 'X-Client-Info': 'bookingblues-api' },
      },
    });
  }

  /** Returns the service-role client. Throws if credentials weren't configured. */
  db(): SupabaseClient<Database> {
    if (!this.client) {
      throw new AppError({
        code: 'supabase.no_credentials',
        status: 500,
        detail:
          'SupabaseService requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
          'Set them in your environment.',
      });
    }
    return this.client;
  }
}
