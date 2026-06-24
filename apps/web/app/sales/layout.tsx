import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Logo } from '../../components/Logo';
import { SignOutButton } from '../../components/SignOutButton';
import { getSupabaseServerClient } from '../../lib/supabase/server';

/**
 * Sales-rep shell (#4). Sales reps are not operators (no `operators` row), so
 * this is a minimal surface separate from the operator dashboard. Middleware
 * already gates /sales to role sales/admin; we double-check here and fail
 * closed if it's somehow bypassed.
 */
export default async function SalesLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const role = (data.user.app_metadata as { role?: unknown } | undefined)?.role;
  if (role !== 'sales' && role !== 'admin') redirect('/dashboard');

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <header className="border-b border-slate-200 px-6 py-3 flex items-center gap-4">
        <Link href="/sales" className="no-underline" aria-label="KeeprSteady Sales">
          <Logo />
        </Link>
        <span className="text-sm font-semibold text-ink">Sales</span>
        <div className="ml-auto flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline">{data.user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 px-6 py-6 max-w-5xl w-full mx-auto">{children}</main>
    </div>
  );
}
