'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmModal } from '../ConfirmModal';
import { publicEnv } from '../../lib/env';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';

interface Props {
  readonly operator: {
    readonly id: string;
    readonly business_name: string;
    readonly has_subscription: boolean;
    readonly has_twilio: boolean;
  };
}

type ActionKey =
  | null
  | 'deactivate'
  | 'cancelSub'
  | 'releaseTwilio'
  | 'impersonate';

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await authedFetch(path, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = (await res.json()) as { detail?: string };
      if (b.detail) detail = b.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json();
}

export function OperatorActions(props: Props): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState<ActionKey>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function openAction(key: Exclude<ActionKey, null>): void {
    setReason('');
    setError(null);
    setOpen(key);
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-3 text-sm font-semibold text-amber-800 dark:text-amber-300">Actions</span>
        <button
          type="button"
          onClick={() => openAction('impersonate')}
          className="rounded-md border border-amber-300 dark:border-amber-700 bg-paper dark:bg-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm hover:bg-amber-100 dark:hover:bg-amber-950"
        >
          Impersonate
        </button>
        {props.operator.has_subscription ? (
          <button
            type="button"
            onClick={() => openAction('cancelSub')}
            className="rounded-md border border-amber-300 dark:border-amber-700 bg-paper dark:bg-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm hover:bg-amber-100 dark:hover:bg-amber-950"
          >
            Cancel subscription
          </button>
        ) : null}
        {props.operator.has_twilio ? (
          <button
            type="button"
            onClick={() => openAction('releaseTwilio')}
            className="rounded-md border border-amber-300 dark:border-amber-700 bg-paper dark:bg-slate-900 dark:text-slate-100 px-3 py-1.5 text-sm hover:bg-amber-100 dark:hover:bg-amber-950"
          >
            Release Twilio number
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => openAction('deactivate')}
          className="rounded-md border border-red-300 dark:border-red-700 bg-paper dark:bg-slate-900 px-3 py-1.5 text-sm text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
        >
          Deactivate operator
        </button>
      </div>
      {error ? (
        <p className="mt-2 rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}

      <ConfirmModal
        open={open === 'deactivate'}
        title="Deactivate this operator?"
        severity="danger"
        confirmLabel="Deactivate"
        typeToConfirm={props.operator.business_name}
        body={
          <div className="space-y-3">
            <p>
              This cancels the Stripe subscription, closes in-progress conversations, and locks the
              account. The Twilio number is NOT released by this action — use the "Release Twilio
              number" button separately if you want to free it.
            </p>
            <label className="block text-xs text-muted dark:text-slate-400">
              Reason (required, recorded in audit log)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                rows={2}
                required
              />
            </label>
          </div>
        }
        onClose={() => setOpen(null)}
        onConfirm={async () => {
          if (!reason.trim()) throw new Error('Reason is required');
          await postJson(`/v1/admin/operators/${props.operator.id}/deactivate`, {
            reason,
            immediate: true,
          });
          setOpen(null);
          router.refresh();
        }}
      />

      <ConfirmModal
        open={open === 'cancelSub'}
        title="Cancel the operator's subscription?"
        severity="warning"
        confirmLabel="Cancel subscription"
        body={
          <div className="space-y-3">
            <p>
              Stops the BookingBlues subscription. By default, the cancellation takes effect at the
              end of the current billing period (the operator keeps access until then). Check the
              "immediate" box if you need to cancel right away.
            </p>
            <label className="block text-xs text-muted dark:text-slate-400">
              Reason (required, recorded in audit log)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                rows={2}
                required
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                id="cancel-immediate"
                defaultChecked={false}
              />
              Cancel immediately (skip end-of-period grace)
            </label>
          </div>
        }
        onClose={() => setOpen(null)}
        onConfirm={async () => {
          if (!reason.trim()) throw new Error('Reason is required');
          const immediate =
            (document.getElementById('cancel-immediate') as HTMLInputElement | null)?.checked ===
            true;
          await postJson(`/v1/admin/operators/${props.operator.id}/cancel-subscription`, {
            reason,
            immediate,
          });
          setOpen(null);
          router.refresh();
        }}
      />

      <ConfirmModal
        open={open === 'releaseTwilio'}
        title="Release this operator's Twilio number?"
        severity="warning"
        confirmLabel="Release number"
        body={
          <p>
            The number returns to Twilio's available pool and can't be reused for this operator.
            You should usually do this only after the subscription is canceled — otherwise the
            operator's voice + SMS will stop working immediately.
          </p>
        }
        onClose={() => setOpen(null)}
        onConfirm={async () => {
          await postJson(`/v1/admin/operators/${props.operator.id}/release-twilio-number`, {});
          setOpen(null);
          router.refresh();
        }}
      />

      <ConfirmModal
        open={open === 'impersonate'}
        title="Generate impersonation link?"
        severity="warning"
        confirmLabel="Generate link"
        body={
          <div className="space-y-3">
            <p>
              Generates a magic-link URL that logs you in as this operator. Open it in a private
              tab. Every impersonation is recorded in the audit log.
            </p>
            <label className="block text-xs text-muted dark:text-slate-400">
              Reason (required, recorded in audit log)
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 dark:text-slate-100 px-3 py-2 text-sm focus:border-accent focus:outline-none"
                rows={2}
                required
              />
            </label>
          </div>
        }
        onClose={() => setOpen(null)}
        onConfirm={async () => {
          if (!reason.trim()) throw new Error('Reason is required');
          const resp = (await postJson(`/v1/admin/operators/${props.operator.id}/impersonate`, {
            reason,
          })) as { action_link?: string };
          setOpen(null);
          if (resp.action_link) {
            window.open(resp.action_link, '_blank', 'noopener,noreferrer');
          } else {
            setError('No action link returned from API');
          }
        }}
      />
    </div>
  );
}
