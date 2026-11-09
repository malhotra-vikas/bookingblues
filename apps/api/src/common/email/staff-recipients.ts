import type { SupabaseClient } from '@supabase/supabase-js';

/** Only the auth admin API is used, so any typed Supabase client fits. */
type AuthAdminClient = Pick<SupabaseClient, 'auth'>;

const ADMIN_PAGE_SIZE = 200;

/**
 * Login email of an operator's auth user. Throws on lookup failure; callers that
 * must never block (alerts) catch and log.
 */
export async function fetchOperatorEmail(db: AuthAdminClient, userId: string): Promise<string | null> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error) throw error;
  return data.user?.email ?? null;
}

/**
 * Every KeeprSteady admin's email (auth users with `app_metadata.role = 'admin'`),
 * looked up live so promoting/demoting an admin needs no config change.
 */
export async function fetchAdminEmails(db: AuthAdminClient): Promise<string[]> {
  const out: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: ADMIN_PAGE_SIZE });
    if (error) throw error;
    for (const u of data.users) {
      const role = (u.app_metadata as { role?: unknown } | undefined)?.role;
      if (role === 'admin' && u.email) out.push(u.email);
    }
    if (data.users.length < ADMIN_PAGE_SIZE) return out;
  }
}
