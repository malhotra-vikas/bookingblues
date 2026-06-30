'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Periodically re-fetches the dashboard's server-rendered data via
 * `router.refresh()` (re-runs the server component, reconciles in place — no
 * full reload, scroll/state preserved). Pauses while the tab is hidden so we
 * don't poll in the background, and refreshes immediately on regaining focus
 * so a returning operator always sees current numbers.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }): JSX.Element {
  const router = useRouter();
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const savedRefresh = useRef<() => void>(() => undefined);

  savedRefresh.current = (): void => {
    router.refresh();
    setRefreshedAt(Date.now());
  };

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = (): void => {
      if (timer) return;
      timer = setInterval(() => savedRefresh.current(), intervalMs);
    };
    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        savedRefresh.current(); // catch up immediately
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return (
    <span className="text-[11px] text-muted dark:text-slate-500" suppressHydrationWarning>
      {refreshedAt
        ? `Updated ${new Date(refreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Auto-refreshing'}
    </span>
  );
}
