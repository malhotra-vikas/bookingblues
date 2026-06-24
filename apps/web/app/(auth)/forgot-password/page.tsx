'use client';

import Link from 'next/link';
import { useState } from 'react';

import { BRAND } from '../../../lib/brand';
import { publicEnv } from '../../../lib/env';
import { getSupabaseBrowserClient } from '../../../lib/supabase/browser';

export default function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password` },
      );
      if (resetErr) throw resetErr;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink mb-1">Reset your password</h1>
      <p className="text-sm text-muted mb-6">
        Enter your email and we&apos;ll send you a link to set a new password.
      </p>

      {sent ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          If an account exists for that email, a reset link is on its way. Check your inbox.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
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
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}

      <p className="mt-6 text-sm text-muted text-center">
        Remembered it?{' '}
        <Link href="/login" className="text-accent font-medium">
          Back to sign in
        </Link>
      </p>
      <p className="mt-1 text-xs text-muted text-center">{BRAND.name}</p>
    </div>
  );
}
