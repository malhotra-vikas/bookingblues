import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { publicEnv } from '../../../lib/env';
import { getSupabaseServerClient } from '../../../lib/supabase/server';

/**
 * Server-side auth callback for PKCE links (email confirmation + password
 * recovery). `@supabase/ssr` issues a `?code` that must be exchanged here so
 * the session cookie is written before we redirect into the app — without this
 * the confirmation link just lands on the Supabase Site URL (the home page).
 *
 * The caller sets `?next=` on the redirectTo it passes to Supabase:
 *   - signup confirm → /onboarding
 *   - password reset → /reset-password
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const nextParam = url.searchParams.get('next') ?? '/dashboard';
  // Open-redirect guard: only same-site relative paths.
  const dest = nextParam.startsWith('/') ? nextParam : '/dashboard';
  const base = publicEnv.NEXT_PUBLIC_APP_URL;

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}${dest}`);
  }

  return NextResponse.redirect(`${base}/login?error=auth_link`);
}
