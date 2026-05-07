'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSupabaseBrowserClient } from '../lib/supabase/browser';

export function SignOutButton(): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await getSupabaseBrowserClient().auth.signOut();
        router.replace('/login');
        router.refresh();
      }}
      className="text-sm text-muted hover:text-ink"
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
