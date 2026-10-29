'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const POLL_MS = 2000;
const MAX_POLLS = 10;

/** Small inline spinner shared by the plan-status "working" states. */
export function Spinner(): JSX.Element {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent align-[-2px]"
    />
  );
}

/**
 * After a return from the Stripe billing portal, the plan change lands via
 * webhook a few seconds later — the page would otherwise show stale status
 * until the next manual reload. Re-fetch the server data every 2s until the
 * plan `signature` changes (or ~20s pass), then drop the query flag so a
 * reload doesn't poll again.
 */
export function PlanSync({ active, signature }: { active: boolean; signature: string }): JSX.Element | null {
  const router = useRouter();
  const initial = useRef(signature);
  const [polls, setPolls] = useState(0);
  const syncing = active && signature === initial.current && polls < MAX_POLLS;

  useEffect(() => {
    if (!syncing) return;
    const t = setTimeout(() => {
      router.refresh();
      setPolls((n) => n + 1);
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [syncing, polls, router]);

  useEffect(() => {
    if (active && !syncing) {
      const url = new URL(window.location.href);
      url.searchParams.delete('billing');
      window.history.replaceState(null, '', url.toString());
    }
  }, [active, syncing]);

  if (!syncing) return null;
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted dark:text-slate-400">
      <Spinner /> Checking for plan changes…
    </p>
  );
}
