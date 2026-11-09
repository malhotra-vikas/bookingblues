'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { postJson } from './OperatorActions';

interface Props {
  readonly operator: {
    readonly id: string;
    readonly trial_ends_at: string | null;
    readonly timezone: string | null;
    /** True for a Stripe trial; false for a comped / sales-rep trial (no subscription). */
    readonly has_subscription: boolean;
  };
}

const inputClass =
  'mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-accent focus:outline-none';

/** `YYYY-MM-DDTHH:MM` in the browser's local time, for a datetime-local input. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function describe(iso: string, timeZone: string | null): string {
  return new Date(iso).toLocaleString('en-US', {
    ...(timeZone ? { timeZone } : {}),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Admin control to move an in-trial operator's trial end. For a Stripe trial
 * the API changes the subscription's trial_end, which is what decides when the
 * card is first charged; for a comped trial it only changes our record.
 */
export function TrialEndCard({ operator }: Props): JSX.Element {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(toLocalInput(operator.trial_ends_at));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    // datetime-local has no zone: it's the admin's browser time.
    const when = new Date(value);
    if (!value || Number.isNaN(when.getTime())) return setError('Pick a date and time');
    if (when.getTime() < Date.now() + 60 * 60 * 1000) return setError('Pick a time at least an hour from now');
    if (!reason.trim()) return setError('Reason is required');
    setBusy(true);
    try {
      await postJson(`/v1/admin/operators/${operator.id}/trial-end`, {
        trial_ends_at: when.toISOString(),
        reason,
      });
      setEditing(false);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const preview = value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString() : null;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold dark:text-slate-100">Trial end</h2>
          <p className="mt-1 text-sm dark:text-slate-200">
            {operator.trial_ends_at ? describe(operator.trial_ends_at, operator.timezone) : 'Not set'}
            <span className="ml-2 text-xs text-muted dark:text-slate-400">
              {operator.has_subscription
                ? 'Stripe trial: their card is charged when it ends.'
                : 'Comped trial (no subscription): no card is charged.'}
            </span>
          </p>
        </div>
        {!editing ? (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setValue(toLocalInput(operator.trial_ends_at));
              setEditing(true);
            }}
            className="rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Change trial end
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted dark:text-slate-400">
            New trial end (your local time)
            <input
              type="datetime-local"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className={inputClass}
              required
            />
          </label>
          <label className="block text-xs text-muted dark:text-slate-400">
            Reason (required, recorded in audit log)
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} required />
          </label>
          <p className="text-xs text-muted dark:text-slate-400 sm:col-span-2">
            {preview ? <>That is {describe(preview, operator.timezone)} for the operator. </> : null}
            {operator.has_subscription
              ? 'Stripe will charge their card at this time unless they cancel first. No charge is made now.'
              : 'Only our record changes; there is no Stripe subscription to update.'}
          </p>
          {error ? <p className="text-sm text-red-600 dark:text-red-400 sm:col-span-2">{error}</p> : null}
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save trial end'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={busy}
              className="rounded-md border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm dark:text-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
