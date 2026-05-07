import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Nav } from '../../components/Nav';
import { getSupabaseServerClient } from '../../lib/supabase/server';

export default async function DashboardLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');

  return (
    <div className="min-h-screen flex flex-col">
      <Nav activeUser={{ email: data.user.email ?? null }} />
      <main className="flex-1 px-6 py-6 max-w-5xl w-full mx-auto">{children}</main>
    </div>
  );
}
