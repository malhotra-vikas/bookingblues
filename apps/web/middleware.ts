import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { BRAND, TERMS } from './lib/brand';

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

/**
 * The survey subdomain (missedcalls.keeprsteady.com) is served by this same
 * Next app. It has exactly one page: the root serves /survey, and every other
 * path bounces to the apex domain so the subdomain can never shadow the
 * marketing site or split its SEO. Matched by leading label so Railway preview
 * hosts and a local `missedcalls.localhost:3000` work too.
 */
const SURVEY_HOST_LABEL = BRAND.surveyHost.split('.')[0]!;

function isSurveyHost(req: NextRequest): boolean {
  const host = (req.headers.get('host') ?? '').toLowerCase().split(':')[0] ?? '';
  return host === BRAND.surveyHost || host.startsWith(`${SURVEY_HOST_LABEL}.`);
}

export async function middleware(req: NextRequest) {
  // Handle the survey host first and return early: the questionnaire is public,
  // so there's no reason to pay for a Supabase token refresh on every hit.
  if (isSurveyHost(req)) {
    const path = req.nextUrl.pathname;
    if (path === '/' || path === '/survey') {
      const url = req.nextUrl.clone();
      url.pathname = '/survey';
      return NextResponse.rewrite(url);
    }
    // Anything else on this host belongs to the main site (the footer's
    // /terms and /privacy links land here). Send it to the apex, preserving
    // path + query.
    const away = new URL(`https://${BRAND.domain}${path}${req.nextUrl.search}`);
    return NextResponse.redirect(away, 308);
  }

  // NOTE: keeprsteady.com/survey deliberately serves the questionnaire directly
  // rather than redirecting to the subdomain.
  //
  // Railway must register a custom domain before it can terminate TLS for it, so
  // missedcalls.keeprsteady.com cannot be made to work from Cloudflare alone.
  // The apex is therefore the questionnaire's real home, and the subdomain is an
  // optional vanity alias that 301s here via a Cloudflare Redirect Rule.
  //
  // Do NOT reintroduce an apex → subdomain redirect while that rule exists: the
  // two would bounce off each other in an infinite loop. `alternates.canonical`
  // in app/survey/page.tsx points at the apex for the same reason.

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
