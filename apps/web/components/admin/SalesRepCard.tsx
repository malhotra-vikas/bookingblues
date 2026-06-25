'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { publicEnv } from '../../lib/env';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';

interface ClaimedLead {
  lead_user_id: string;
  email: string | null;
  business_name: string | null;
  operator_id: string | null;
  claimed_at: string | null;
}

export interface SalesRep {
  user_id: string;
  email: string | null;
  slack_user_id: string;
  slack_username: string | null;
  linked_at: string;
  claimed_leads: ClaimedLead[];
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * One sales rep on /admin/sales: shows their email↔Slack link and their claimed
 * leads with checkboxes. Admins can selectively release leads (one / several /
 * all → back to #bb-leads) without demoting, or remove the sales role entirely
 * (which leaves their claims intact, since claims belong to the Slack identity).
 */
export function SalesRepCard({ rep }: { rep: SalesRep }): JSX.Element {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const leads = rep.claimed_leads;
  const allSelected = leads.length > 0 && selected.size === leads.length;

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.lead_user_id)));
  }

  async function releaseSelected(): Promise<void> {
    if (selected.size === 0) return;
    setBusy('release');
    setError(null);
    setInfo(null);
    try {
      const res = await authedFetch(`/v1/admin/sales/${rep.user_id}/release-leads`, {
        method: 'POST',
        body: JSON.stringify({ lead_user_ids: [...selected] }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `Failed (${res.status})`);
      }
      const body = (await res.json()) as { released_leads: number };
      setInfo(`Released ${body.released_leads} lead${body.released_leads === 1 ? '' : 's'} to #bb-leads.`);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function demote(): Promise<void> {
    const ok = window.confirm(
      `Remove the sales role from ${rep.email ?? rep.slack_user_id}?\n\nThis unlinks their email from Slack ${rep.slack_user_id}. Their ${leads.length} claimed lead${leads.length === 1 ? '' : 's'} are NOT released — release those first if you want them back in the pool.`,
    );
    if (!ok) return;
    setBusy('demote');
    setError(null);
    setInfo(null);
    try {
      const res = await authedFetch(`/v1/admin/sales/${rep.user_id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `Failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-ink dark:text-slate-100">{rep.email ?? '—'}</div>
          <div className="mt-0.5 text-xs text-muted dark:text-slate-400">
            Slack <span className="font-mono">{rep.slack_user_id}</span>
            {rep.slack_username ? ` (${rep.slack_username})` : ''} · linked{' '}
            {new Date(rep.linked_at).toLocaleDateString()}
          </div>
        </div>
        <button
          type="button"
          onClick={demote}
          disabled={busy != null}
          className="shrink-0 rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-700 hover:border-red-500 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          {busy === 'demote' ? 'Removing…' : 'Remove sales role'}
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted dark:text-slate-400">
            Claimed leads ({leads.length})
          </span>
          {leads.length > 0 ? (
            <button
              type="button"
              onClick={releaseSelected}
              disabled={busy != null || selected.size === 0}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {busy === 'release' ? 'Releasing…' : `Release selected (${selected.size})`}
            </button>
          ) : null}
        </div>

        {leads.length === 0 ? (
          <p className="text-xs text-muted dark:text-slate-400">No claimed leads.</p>
        ) : (
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-xs text-muted dark:text-slate-400">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all
            </label>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {leads.map((lead) => (
                <li key={lead.lead_user_id} className="flex items-center gap-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.lead_user_id)}
                    onChange={() => toggle(lead.lead_user_id)}
                  />
                  <span className="text-ink dark:text-slate-100">
                    {lead.business_name ?? <span className="text-muted">(unnamed)</span>}
                  </span>
                  <span className="text-xs text-muted dark:text-slate-400">{lead.email ?? '—'}</span>
                  {!lead.operator_id ? (
                    <span className="text-[11px] text-muted">· no operator yet</span>
                  ) : null}
                  {lead.claimed_at ? (
                    <span className="ml-auto text-[11px] text-muted dark:text-slate-500">
                      {new Date(lead.claimed_at).toLocaleDateString()}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        {info ? <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{info}</p> : null}
      </div>
    </div>
  );
}
