import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { LegalFooter } from '../../components/LegalFooter';
import { Nav } from '../../components/Nav';
import { getSupabaseServerClient } from '../../lib/supabase/server';

export default async function DashboardLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const isAdmin = (data.user.app_metadata as { role?: unknown } | undefined)?.role === 'admin';

  return (
    <div className="min-h-screen flex flex-col">
      {/* Site chrome is hidden when printing (e.g. the Settings call-us poster). */}
      <div className="print:hidden">
        <Nav activeUser={{ email: data.user.email ?? null }} isAdmin={isAdmin} />
      </div>
      <main className="flex-1 px-6 py-6 max-w-5xl w-full mx-auto print:p-0">{children}</main>
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-12 print:hidden">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <LegalFooter variant="marketing" />
        </div>
      </footer>
    </div>
  );
}
