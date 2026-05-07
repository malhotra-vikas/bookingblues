import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/dashboard', '/onboarding', '/settings'];
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
