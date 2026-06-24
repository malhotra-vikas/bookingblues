'use client';

import { useState } from 'react';

import { publicEnv } from '../../lib/env';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';

/**
 * "Login as" for sales reps (#4). POSTs to the scoped sales impersonation
 * endpoint (the API verifies the rep claimed this lead) and opens the returned
 * magic link in a new tab. Mirrors the admin OperatorActions impersonate flow.
 */
export function SalesImpersonateButton({
  operatorId,
  businessName,
}: {
  operatorId: string;
  businessName: string;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loginAs(): Promise<void> {
    const reason = window.prompt(
      `Login as ${businessName}?\n\nReason (audit-logged):`,
      'Onboarding assistance',
    );
    if (!reason || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(
        `${publicEnv.NEXT_PUBLIC_API_URL}/v1/sales/operators/${operatorId}/impersonate`,
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
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `Failed (${res.status})`);
      }
      const body = (await res.json()) as { action_link?: string };
      if (body.action_link) {
        window.open(body.action_link, '_blank', 'noopener,noreferrer');
      } else {
        throw new Error('No login link returned');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={loginAs}
        disabled={busy}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {busy ? 'Opening…' : 'Login as'}
      </button>
      {error ? <span className="text-[11px] text-red-600">{error}</span> : null}
    </div>
  );
}
