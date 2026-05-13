'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { getSupabaseBrowserClient } from '../../lib/supabase/browser';
import { publicEnv } from '../../lib/env';

export function LeadRowActions({
  userId,
  email,
  emailVerified,
}: {
  userId: string;
  email: string | null;
  emailVerified: boolean;
}): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verifyEmail(): Promise<void> {
    const reason = window.prompt(
      `Mark email verified for ${email ?? 'this user'}?\n\nReason (audit-logged):`,
    );
    if (!reason || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(
        `${publicEnv.NEXT_PUBLIC_API_URL}/v1/admin/leads/${userId}/verify-email`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (emailVerified) {
    return <span className="text-xs text-muted dark:text-slate-400">verified</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={verifyEmail}
        disabled={busy}
        className="text-xs rounded-md border border-slate-300 dark:border-slate-700 dark:text-slate-200 px-2.5 py-1 hover:border-emerald-600 hover:text-emerald-700 dark:hover:border-emerald-500 dark:hover:text-emerald-400 disabled:opacity-50"
      >
        {busy ? 'Verifying…' : 'Mark email verified'}
      </button>
      {error ? <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span> : null}
    </div>
  );
}
