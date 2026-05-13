import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { SignOutButton } from '../../components/SignOutButton';
import { ThemeToggle } from '../../components/ThemeToggle';
import { getSupabaseServerClient } from '../../lib/supabase/server';

/**
 * Admin shell — distinct from the operator dashboard layout in two ways:
 *   1. A persistent red banner so staff never confuse a customer's view with
 *      their own privileged surface.
 *   2. A second auth gate. Middleware already redirects non-admins away, but
 *      the layout double-checks because middleware can be bypassed by
 *      misconfigured matchers and we'd rather fail closed.
 */
export default async function AdminLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const role = (data.user.app_metadata as { role?: unknown } | undefined)?.role;
  if (role !== 'admin') redirect('/dashboard');

  return (
    <div className="min-h-screen flex flex-col bg-paper dark:bg-slate-950">
      <div className="bg-red-700 dark:bg-red-900 px-6 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-white">
        BookingBlues Admin · Internal use only · Every action is logged
      </div>
      <header className="border-b border-red-100 dark:border-red-900/50 bg-paper dark:bg-slate-900 px-6 py-3 flex items-center gap-6">
        <Link href="/admin" className="font-semibold text-red-700 dark:text-red-400 no-underline">
          BB · Admin
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin" className="no-underline">
            Overview
          </Link>
          <Link href="/admin/leads" className="no-underline">
            Leads
          </Link>
          <Link href="/admin/operators" className="no-underline">
            Operators
          </Link>
          <Link href="/admin/sales-calculator" className="no-underline">
            Sales Calculator
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted">
          <Link href="/dashboard" className="no-underline text-ink dark:text-slate-200">
            ← Exit admin
          </Link>
          <span className="hidden sm:inline dark:text-slate-400">{data.user.email}</span>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 px-6 py-6 max-w-6xl w-full mx-auto">{children}</main>
    </div>
  );
}
