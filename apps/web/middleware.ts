import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/onboarding', '/settings', '/admin'];
const ADMIN_PREFIXES = ['/admin'];
const AUTH_PAGES = ['/login', '/signup'];

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
  if (wantsAuthPage && isAuthed) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
