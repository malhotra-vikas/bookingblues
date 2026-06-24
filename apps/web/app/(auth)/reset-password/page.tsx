'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getSupabaseBrowserClient } from '../../../lib/supabase/browser';

/**
 * Final step of the reset flow. The /auth/callback route has already exchanged
 * the recovery `?code` and written the session cookie, so here we just collect
 * the new password and call updateUser. If there's no recovery session (link
 * expired or opened standalone), we send the user back to request a new link.
 */
export default function ResetPasswordPage(): JSX.Element {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      setHasSession(data.user != null);
      setReady(true);
    });
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: updErr } = await supabase.auth.updateUser({ password });
      if (updErr) throw updErr;
      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update your password');
      setBusy(false);
    }
  }

  if (!ready) return <p className="text-sm text-muted">Loading…</p>;

  if (!hasSession) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink mb-1">Link expired</h1>
        <p className="text-sm text-muted mb-6">
          This password reset link is invalid or has expired. Request a fresh one.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block rounded-md bg-accent px-4 py-2.5 text-base font-medium text-white no-underline"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink mb-1">Set a new password</h1>
      <p className="text-sm text-muted mb-6">Choose a new password for your account.</p>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            New password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 outline-none focus:border-accent"
          />
        </div>
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-4 py-2.5 text-base font-medium text-white shadow-sm hover:bg-accent-dark transition-colors disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Update password'}
        </button>
      </form>
    </div>
  );
}
