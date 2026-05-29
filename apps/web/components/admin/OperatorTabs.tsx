'use client';

import { useEffect, useState } from 'react';

import { ConfirmModal } from '../ConfirmModal';
import { publicEnv } from '../../lib/env';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';

type TabKey = 'conversations' | 'appointments' | 'payments' | 'audit';

interface Conversation {
  id: string;
  caller_phone_e164: string;
  status: string;
  outcome: string | null;
  last_message_at: string | null;
  started_at: string;
}
interface Appointment {
  id: string;
  caller_name: string;
  caller_phone_e164: string;
  scheduled_for_start: string;
  status: string;
  fee_status: string;
  fee_cents: number | null;
}
interface Payment {
  id: string;
  amount_cents: number;
  application_fee_cents: number;
  currency: string;
  status: string;
  created_at: string;
}
interface AuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_user_id: string | null;
}

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

async function getJson<T>(path: string): Promise<T> {
  const res = await authedFetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
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

export function OperatorTabs({ operatorId }: { operatorId: string }): JSX.Element {
  const [tab, setTab] = useState<TabKey>('conversations');

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        <TabBtn id="conversations" active={tab} onClick={setTab} label="Conversations" />
        <TabBtn id="appointments" active={tab} onClick={setTab} label="Appointments" />
        <TabBtn id="payments" active={tab} onClick={setTab} label="Payments" />
        <TabBtn id="audit" active={tab} onClick={setTab} label="Audit log" />
      </div>
      {tab === 'conversations' ? <ConversationsTab operatorId={operatorId} /> : null}
      {tab === 'appointments' ? <AppointmentsTab operatorId={operatorId} /> : null}
      {tab === 'payments' ? <PaymentsTab operatorId={operatorId} /> : null}
      {tab === 'audit' ? <AuditTab operatorId={operatorId} /> : null}
    </section>
  );
}

function TabBtn({
  id,
  active,
  onClick,
  label,
}: {
  id: TabKey;
  active: TabKey;
  onClick: (k: TabKey) => void;
  label: string;
}): JSX.Element {
  const on = id === active;
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${on ? 'border-accent font-medium text-accent dark:text-accent-light' : 'border-transparent text-muted dark:text-slate-400 hover:text-ink dark:hover:text-slate-100'}`}
    >
      {label}
    </button>
  );
}

// ── Conversations ──────────────────────────────────────────────────────────

function ConversationsTab({ operatorId }: { operatorId: string }): JSX.Element {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getJson<{ items: Conversation[] }>(
          `/v1/admin/operators/${operatorId}/conversations`,
        );
        if (!cancelled) setRows(data.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [operatorId]);

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase tracking-wide text-muted dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Caller</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Last msg</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 font-mono text-xs">{c.caller_phone_e164}</td>
                <td className="px-3 py-2">{c.status}</td>
                <td className="px-3 py-2 text-muted dark:text-slate-400">{c.outcome ?? '—'}</td>
                <td className="px-3 py-2 text-muted dark:text-slate-400 text-xs">
                  {c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {c.status !== 'completed' && c.status !== 'abandoned' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReason('');
                        setConfirmFor(c.id);
                      }}
                      disabled={busyId === c.id}
                      className="rounded border border-red-200 dark:border-red-900 px-2 py-1 text-xs text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                    >
                      {busyId === c.id ? 'Working…' : 'Force end'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted dark:text-slate-400">
                  No conversations.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={confirmFor != null}
        title="Force-end this conversation?"
        severity="danger"
        confirmLabel="Force end"
        body={
          <div className="space-y-3">
            <p>
              Marks the conversation as <code>completed</code> with outcome <code>rejected</code>.
              The bot will not reply to further caller messages on this conversation.
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
        onClose={() => setConfirmFor(null)}
        onConfirm={async () => {
          if (!confirmFor || !reason.trim()) {
            throw new Error('Reason is required');
          }
          setBusyId(confirmFor);
          try {
            await postJson(`/v1/admin/conversations/${confirmFor}/force-end`, {
              outcome: 'rejected',
              reason,
            });
            setRows((rs) =>
              rs.map((r) =>
                r.id === confirmFor ? { ...r, status: 'completed', outcome: 'rejected' } : r,
              ),
            );
          } finally {
            setBusyId(null);
            setConfirmFor(null);
          }
        }}
      />
    </div>
  );
}

// ── Appointments ──────────────────────────────────────────────────────────

function AppointmentsTab({ operatorId }: { operatorId: string }): JSX.Element {
  const [rows, setRows] = useState<Appointment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getJson<{ items: Appointment[] }>(
          `/v1/admin/operators/${operatorId}/appointments`,
        );
        if (!cancelled) setRows(data.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [operatorId]);

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase tracking-wide text-muted dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Caller</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">{a.caller_name}</td>
                <td className="px-3 py-2 text-xs">
                  {new Date(a.scheduled_for_start).toLocaleString()}
                </td>
                <td className="px-3 py-2">{a.status}</td>
                <td className="px-3 py-2 text-xs">
                  {a.fee_cents != null ? `$${(a.fee_cents / 100).toFixed(2)} (${a.fee_status})` : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted dark:text-slate-400">
                  No appointments.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────

function PaymentsTab({ operatorId }: { operatorId: string }): JSX.Element {
  const [rows, setRows] = useState<Payment[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getJson<{ items: Payment[] }>(
          `/v1/admin/operators/${operatorId}/payments`,
        );
        if (!cancelled) setRows(data.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [operatorId]);

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase tracking-wide text-muted dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Our cut</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs">{new Date(p.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">${(p.amount_cents / 100).toFixed(2)} {p.currency.toUpperCase()}</td>
                <td className="px-3 py-2">${(p.application_fee_cents / 100).toFixed(2)}</td>
                <td className="px-3 py-2">{p.status}</td>
                <td className="px-3 py-2 text-right">
                  {p.status === 'succeeded' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReason('');
                        setConfirmFor(p.id);
                      }}
                      disabled={busyId === p.id}
                      className="rounded border border-red-200 dark:border-red-900 px-2 py-1 text-xs text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                    >
                      {busyId === p.id ? 'Refunding…' : 'Refund'}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted dark:text-slate-400">
                  No payments.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <ConfirmModal
        open={confirmFor != null}
        title="Refund this payment?"
        severity="danger"
        confirmLabel="Refund"
        body={
          <div className="space-y-3">
            <p>
              Issues a full refund to the caller on the operator's Stripe Connect account, and
              reverses KeeprSteady' application fee. Cannot be undone.
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
        onClose={() => setConfirmFor(null)}
        onConfirm={async () => {
          if (!confirmFor || !reason.trim()) throw new Error('Reason is required');
          setBusyId(confirmFor);
          try {
            await postJson(
              `/v1/admin/operators/${operatorId}/refund-payment/${confirmFor}`,
              { reason },
            );
            setRows((rs) =>
              rs.map((r) => (r.id === confirmFor ? { ...r, status: 'refunded' } : r)),
            );
          } finally {
            setBusyId(null);
            setConfirmFor(null);
          }
        }}
      />
    </div>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────────

function AuditTab({ operatorId }: { operatorId: string }): JSX.Element {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await getJson<{ items: AuditEntry[] }>(
          `/v1/admin/operators/${operatorId}/audit-log`,
        );
        if (!cancelled) setRows(data.items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [operatorId]);

  return (
    <div className="space-y-2">
      {error ? (
        <p className="rounded-md bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase tracking-wide text-muted dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Resource</th>
              <th className="px-3 py-2">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {e.actor_user_id ? e.actor_user_id.slice(0, 8) : '—'}
                </td>
                <td className="px-3 py-2">{e.action}</td>
                <td className="px-3 py-2 text-xs">
                  {e.resource_type}
                  {e.resource_id ? ` · ${e.resource_id.slice(0, 12)}` : ''}
                </td>
                <td className="px-3 py-2 text-xs">
                  <pre className="whitespace-pre-wrap font-mono">
                    {JSON.stringify(e.metadata, null, 0)}
                  </pre>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted dark:text-slate-400">
                  No audit entries.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
