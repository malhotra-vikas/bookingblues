'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BRAND, TERMS } from '../../lib/brand';
import { publicEnv } from '../../lib/env';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';

/**
 * Re-acceptance gate. The middleware redirects here when a signed-in
 * operator's recorded terms_version doesn't match the current TERMS.version.
 * Accepting updates auth.users.user_metadata (the gate's source of truth) and
 * mirrors the acceptance onto the operators row server-side.
 */
export default function AcceptTermsPage(): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next') ?? '/dashboard';

  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Bounce out if not signed in, or already on the current version.
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace('/login');
        return;
      }
      const accepted = (data.user.user_metadata as { terms_version?: unknown })?.terms_version;
      if (accepted === TERMS.version) {
        router.replace(next);
        return;
      }
      setReady(true);
    });
  }, [router, next]);

  async function accept(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      // Primary record + gate source: stamp user_metadata.
      const { error: updErr } = await supabase.auth.updateUser({
        data: { terms_accepted_at: new Date().toISOString(), terms_version: TERMS.version },
      });
      if (updErr) throw updErr;

      // Mirror onto the operators row server-side (best-effort — the
      // user_metadata write above already satisfies the gate). The server
      // sets its own timestamp; we only pass the version we displayed.
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        await fetch(`${publicEnv.NEXT_PUBLIC_API_URL}/v1/operators/me/accept-terms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ version: TERMS.version }),
        }).catch(() => {
          // Swallowed — operators mirror is non-critical; metadata is the record.
        });
      }

      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your acceptance');
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <main className="min-h-screen grid place-items-center px-6">
        <p className="text-sm text-muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center px-6 bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-7">
        <h1 className="text-xl font-semibold tracking-tight text-ink dark:text-slate-100">
          We&apos;ve updated our terms
        </h1>
        <p className="mt-2 text-sm text-muted">
          Our Terms of Service and Privacy Policy changed (effective{' '}
          {TERMS.effectiveDate}). Please review and accept to continue using {BRAND.name}.
        </p>

        <label className="mt-5 flex items-start gap-2 text-[13px] text-ink dark:text-slate-200 leading-snug">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-accent focus:ring-accent"
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" target="_blank" className="underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" target="_blank" className="underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          onClick={accept}
          disabled={!checked || busy}
          className="mt-5 w-full rounded-md bg-accent px-4 py-2.5 text-base font-medium text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Accept and continue'}
        </button>
      </div>
    </main>
  );
}
