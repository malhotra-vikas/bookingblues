'use client';

import { useState } from 'react';

import { publicEnv } from '../../lib/env';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';

/**
 * Admin form to promote a user to the 'sales' role and link their Slack ID
 * (#4). The Slack ID must match what the #bb-leads "Claim" button records
 * (lead_claims.claimed_by_slack_user_id) so the rep's claimed leads resolve.
 */
export function PromoteSalesForm(): JSX.Element {
  const [email, setEmail] = useState('');
  const [slackUserId, setSlackUserId] = useState('');
  const [slackUsername, setSlackUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/admin/sales`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          user_email: email.trim().toLowerCase(),
          slack_user_id: slackUserId.trim(),
          ...(slackUsername.trim() ? { slack_username: slackUsername.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `Failed (${res.status})`);
      }
      setOk(`Promoted ${email.trim().toLowerCase()} to sales.`);
      setEmail('');
      setSlackUserId('');
      setSlackUsername('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <Field id="email" label="User email" type="email" value={email} onChange={setEmail} required
        hint="The user must already have a KeeprSteady account (signed up)." />
      <Field id="slack_user_id" label="Slack user ID" value={slackUserId} onChange={setSlackUserId} required
        hint="Their Slack member ID (e.g. U0123ABCD) — must match #bb-leads claims." />
      <Field id="slack_username" label="Slack username (optional)" value={slackUsername} onChange={setSlackUsername} />
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}
      {ok ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{ok}</div>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Promote to sales'}
      </button>
    </form>
  );
}

function Field({
  id, label, value, onChange, type = 'text', required, hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  hint?: string;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
