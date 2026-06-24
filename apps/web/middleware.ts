import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { TERMS } from './lib/brand';

const PROTECTED_PREFIXES = ['/dashboard', '/onboarding', '/settings', '/admin', '/sales'];
const ADMIN_PREFIXES = ['/admin'];
// Sales-rep surface (#4): role 'sales' or 'admin' only.
const SALES_PREFIXES = ['/sales'];
// Operator-only app pages. Sales reps aren't operators, so we bounce them to
// /sales if they land here (a sales login defaults to /dashboard otherwise).
const OPERATOR_PREFIXES = ['/dashboard', '/onboarding', '/settings'];
const AUTH_PAGES = ['/login', '/signup'];
// Operator-app pages requiring an up-to-date terms acceptance. /admin is
// excluded — internal staff aren't subject to the operator ToS. /accept-terms
// is deliberately NOT a protected prefix, so the gate never redirects to
// itself (no loop).
const TERMS_GATE_PREFIXES = ['/dashboard', '/onboarding', '/settings'];

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const c of cookiesToSet) req.cookies.set(c.name, c.value);
          response = NextResponse.next({ request: req });
          for (const c of cookiesToSet) response.cookies.set(c.name, c.value, c.options);
        },
      },
    },
  );

  // Refresh the access token if needed (writes new cookies on `response`).
  const { data } = await supabase.auth.getUser();
  const isAuthed = data.user != null;

  const path = req.nextUrl.pathname;
  const wantsProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  const wantsAuthPage = AUTH_PAGES.some((p) => path === p);

  if (wantsProtected && !isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Admin pages require role=admin in app_metadata. Non-admins land on the
  // operator dashboard rather than seeing a 403 page (less confusing UX —
  // staff who lose access shouldn't be left staring at a broken admin shell).
  // app_metadata is server-only-writable in Supabase, so we trust this claim
  // (see ADR 0009).
  if (isAuthed && ADMIN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    const role = (data.user?.app_metadata as { role?: unknown } | undefined)?.role;
    if (role !== 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }
  // Role-based routing for sales reps (#4). They have no operator row, so keep
  // them out of the operator app and on their own /sales surface; and gate
  // /sales to sales/admin only.
  if (isAuthed) {
    const userRole = (data.user?.app_metadata as { role?: unknown } | undefined)?.role;
    const wantsSales = SALES_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
    if (wantsSales && userRole !== 'sales' && userRole !== 'admin') {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
    if (
      userRole === 'sales' &&
      OPERATOR_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
    ) {
      const url = req.nextUrl.clone();
      url.pathname = '/sales';
      return NextResponse.redirect(url);
    }
  }

  if (wantsAuthPage && isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Terms re-acceptance gate. If the signed-in operator's recorded
  // terms_version (stamped in user_metadata at signup / last accept) doesn't
  // match the current TERMS.version, force a re-accept before they can use
  // the operator app. Legacy users with no recorded version are caught too.
  if (isAuthed && TERMS_GATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    const accepted = (data.user?.user_metadata as { terms_version?: unknown } | undefined)
      ?.terms_version;
    if (accepted !== TERMS.version) {
      const url = req.nextUrl.clone();
      url.pathname = '/accept-terms';
      url.searchParams.set('next', path);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
