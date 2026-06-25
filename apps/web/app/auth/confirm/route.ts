import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { publicEnv } from '../../../lib/env';
import { getSupabaseServerClient } from '../../../lib/supabase/server';

/**
 * Server-side confirm route for admin-generated magic links (impersonation /
 * "Login as", #4 + admin §8). Unlike the signup/recovery links handled by
 * /auth/callback, these are minted server-side via `auth.admin.generateLink`,
 * so there is no browser PKCE `code_verifier` to exchange. Instead we verify the
 * `token_hash` with `verifyOtp`, which establishes the session cookie directly.
 *
 * NOTE: this swaps the browser's session to the target user (cookies are shared
 * across tabs on the same origin). Open the link in a separate browser profile /
 * incognito window if you need to keep your own session in the original tab.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = (url.searchParams.get('type') ?? 'magiclink') as EmailOtpType;
  const nextParam = url.searchParams.get('next') ?? '/dashboard';
  // Open-redirect guard: only same-site relative paths.
  const dest = nextParam.startsWith('/') ? nextParam : '/dashboard';
  const base = publicEnv.NEXT_PUBLIC_APP_URL;

  if (tokenHash) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${base}${dest}`);
  }

  return NextResponse.redirect(`${base}/login?error=auth_link`);
}
