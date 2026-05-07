'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '../env';

/**
 * Browser-side Supabase client. Uses the anon key — RLS gates real access.
 * Cookies are managed by `@supabase/ssr` so server components see the same
 * session.
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
