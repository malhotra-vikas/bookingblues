'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getSupabaseBrowserClient } from '../lib/supabase/browser';
import { publicEnv } from '../lib/env';

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

// After Stripe Checkout redirects back, the webhook that sets the status usually
// lands a second or two later. Poll the server render briefly instead of
// telling a customer who just paid that their trial hasn't started.
const ACTIVATION_POLL_MS = 2000;
const ACTIVATION_MAX_POLLS = 15;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function TrialBanner({
  status,
  trialEndsAt,
  cancelAt,
  justSubscribed = false,
}: {
  status: string | null;
  trialEndsAt: string | null;
  cancelAt: string | null;
  justSubscribed?: boolean;
}): JSX.Element | null {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);

  const activating = !status && justSubscribed && polls < ACTIVATION_MAX_POLLS;
  useEffect(() => {
    if (!activating) return;
    const t = setTimeout(() => {
      router.refresh();
      setPolls((n) => n + 1);
    }, ACTIVATION_POLL_MS);
    return () => clearTimeout(t);
  }, [activating, polls, router]);

  if (activating) {
    return (
      <span className="text-sm text-muted" role="status">
        Plan status: <span className="font-medium text-ink">activating your trial…</span>
      </span>
    );
  }

  // Scheduled to cancel (Customer Portal): Stripe keeps the status until the date.
  if (cancelAt && (status === 'trialing' || status === 'active')) {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
        Cancels {shortDate(cancelAt)}
      </span>
    );
  }

  // No status until Stripe Checkout completes — the trial starts there, card required.
  if (!status) {
    return (
      <span className="text-sm text-muted">
        Plan status: <span className="font-medium text-ink">trial not started</span>{' '}
        <Link href="/onboarding" className="text-xs text-accent hover:underline">
          Start free trial
        </Link>
      </span>
    );
  }

  if (status !== 'trialing' || !trialEndsAt) {
    return (
      <span className="text-sm text-muted">
        Plan status: <span className="font-medium text-ink">{status}</span>
      </span>
    );
  }

  const msLeft = new Date(trialEndsAt).getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
  const label =
    daysLeft <= 0
      ? 'Trial ended'
      : daysLeft === 1
        ? 'Trial ends today'
        : `In ${daysLeft}-day Trial`;

  async function endTrial(): Promise<void> {
    const ok = window.confirm(
      `End the trial now and charge your card immediately?\n\n` +
        `If the charge succeeds, your subscription becomes active. ` +
        `If it fails, the subscription drops to past_due and the bot ` +
        `degrades to no-booking mode until you fix the payment method.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch('/v1/billing/end-trial', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `end trial failed: ${res.status}`);
      }
      // Stripe webhooks update the operator row asynchronously; refresh after a short delay.
      setTimeout(() => router.refresh(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
        {label}
      </span>
      <button
        type="button"
        onClick={endTrial}
        disabled={busy}
        className="text-xs text-accent hover:underline disabled:opacity-50"
      >
        {busy ? 'Working…' : 'End trial now'}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
