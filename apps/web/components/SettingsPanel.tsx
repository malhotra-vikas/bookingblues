'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSupabaseBrowserClient } from '../lib/supabase/browser';
import { publicEnv } from '../lib/env';

interface Operator {
  id: string;
  business_name: string;
  category: string | null;
  timezone: string;
  twilio_number_e164: string | null;
  google_calendar_id: string | null;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  subscription_status: string | null;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(`${publicEnv.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function SettingsPanel({ operator }: { operator: Operator }): JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState(operator.business_name);
  const [timezone, setTimezone] = useState(operator.timezone);
  const [feeEnabled, setFeeEnabled] = useState(operator.booking_fee_enabled);
  const [feeDollars, setFeeDollars] = useState(
    operator.booking_fee_cents != null ? (operator.booking_fee_cents / 100).toFixed(2) : '',
  );

  async function run(label: string, fn: () => Promise<void>): Promise<void> {
    setBusy(label);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function saveProfile(): Promise<void> {
    await run('save', async () => {
      const cents = feeEnabled ? Math.max(0, Math.round(Number(feeDollars) * 100)) : null;
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({
          business_name: businessName,
          timezone,
          booking_fee_enabled: feeEnabled,
          ...(cents != null ? { booking_fee_cents: cents } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `save failed: ${res.status}`);
      }
      setInfo('Saved.');
      router.refresh();
    });
  }

  async function disconnectGoogle(): Promise<void> {
    await run('disconnect-google', async () => {
      const res = await authedFetch('/v1/operators/me/google/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error(`disconnect failed: ${res.status}`);
      setInfo("Calendar disconnected. Reconnect from Onboarding when you're ready.");
      router.refresh();
    });
  }

  async function openBillingPortal(): Promise<void> {
    await run('billing-portal', async () => {
      const res = await authedFetch('/v1/billing/portal-session');
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `portal failed: ${res.status}`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  return (
    <div className="space-y-8">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {info ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {info}
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Business profile</h2>
        <div>
          <label className="block text-sm text-muted mb-1">Business name</label>
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full max-w-md"
          />
        </div>
        <div>
          <label className="block text-sm text-muted mb-1">Timezone (IANA, e.g. America/New_York)</label>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full max-w-md"
          />
        </div>
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={feeEnabled}
              onChange={(e) => setFeeEnabled(e.target.checked)}
            />
            Collect a booking fee
          </label>
          {feeEnabled ? (
            <div>
              <label className="block text-xs text-muted">Amount (USD)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={feeDollars}
                onChange={(e) => setFeeDollars(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm w-32"
              />
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={saveProfile}
          disabled={busy === 'save'}
          className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <div className="rounded-md border p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Google Calendar</div>
              <div className="text-xs text-muted">
                {operator.google_calendar_id ? `Connected (${operator.google_calendar_id})` : 'Not connected'}
              </div>
            </div>
            {operator.google_calendar_id ? (
              <button
                type="button"
                onClick={disconnectGoogle}
                disabled={busy === 'disconnect-google'}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {busy === 'disconnect-google' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : null}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">Twilio number</div>
              <div className="text-xs text-muted font-mono">
                {operator.twilio_number_e164 ?? 'Not provisioned'}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Billing</h2>
        <p className="text-sm text-muted">
          Manage your subscription, change plans, or cancel via Stripe&apos;s customer portal.
          Subscription status:{' '}
          <span className="font-medium text-ink">{operator.subscription_status ?? 'none'}</span>
        </p>
        <button
          type="button"
          onClick={openBillingPortal}
          disabled={busy === 'billing-portal'}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm"
        >
          {busy === 'billing-portal' ? 'Opening…' : 'Open billing portal'}
        </button>
      </section>
    </div>
  );
}
