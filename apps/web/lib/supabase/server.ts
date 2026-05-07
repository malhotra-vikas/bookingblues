import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { publicEnv } from '../env';

/**
 * Server-side Supabase client. Reads + writes the auth cookie via Next's
 * `cookies()` so server components can read the current session and our
 * middleware can refresh expired access tokens transparently.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const c of cookiesToSet) cookieStore.set(c.name, c.value, c.options);
          } catch {
            // Server Components cannot set cookies; middleware refreshes
            // tokens instead. Swallow to keep RSCs from crashing.
          }
        },
      },
    },
  );
}
