'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSupabaseBrowserClient } from '../../lib/supabase/browser';
import { publicEnv } from '../../lib/env';

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/** Operator "Mark resolved" action on a Recent Conversations row. Closes an open
 *  conversation (status → completed) so post-booking threads don't linger. */
export function ResolveConversationButton({
  conversationId,
  status,
}: {
  conversationId: string;
  status: string;
}): JSX.Element | null {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState('');

  // Only show for still-open conversations. Escalated threads are human-owned —
  // resolve those from Slack, not here.
  const isOpen = status === 'active' || status === 'awaiting_caller' || status === 'awaiting_bot';
  if (!isOpen) return null;

  async function resolve(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      const trimmed = address.trim();
      const res = await authedFetch(`/v1/conversations/${conversationId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(trimmed ? { address: trimmed } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `Couldn't resolve (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-ink hover:bg-slate-50"
      >
        Mark resolved
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Property address (optional)"
        className="rounded-md border border-slate-300 px-2 py-1 text-xs w-48"
      />
      <button
        type="button"
        onClick={resolve}
        disabled={busy}
        className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Resolving…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={busy}
        className="text-xs text-muted hover:underline"
      >
        Cancel
      </button>
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </span>
  );
}
