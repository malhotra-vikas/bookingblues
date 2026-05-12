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
  personal_phone_e164: string | null;
  twilio_number_e164: string | null;
  google_calendar_id: string | null;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
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

function formatE164(e164: string | null): string {
  if (!e164) return '—';
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
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

  const takeBps = publicEnv.NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS;
  const feeCents = Math.max(0, Math.round(Number(feeDollars || '0') * 100));
  const platformCents = Math.max(Math.round((feeCents * takeBps) / 10_000), feeCents > 0 ? 100 : 0);
  const stripeProcessingCents = feeCents > 0 ? Math.round(feeCents * 0.029) + 30 : 0;
  const operatorTakeCents = Math.max(0, feeCents - platformCents - stripeProcessingCents);

  const connectStatus: ConnectStatus =
    !operator.stripe_connect_account_id
      ? 'not_started'
      : operator.stripe_connect_charges_enabled && operator.stripe_connect_payouts_enabled
        ? 'active'
        : 'pending';
  const feeChargeable =
    operator.booking_fee_enabled &&
    operator.booking_fee_cents != null &&
    (operator.subscription_status === 'trialing' || operator.subscription_status === 'active') &&
    operator.stripe_connect_charges_enabled &&
    operator.stripe_connect_payouts_enabled;

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
      const cents = feeEnabled ? feeCents : null;
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
        throw new Error(detail.detail ?? `Save failed (${res.status})`);
      }
      setInfo('Saved.');
      router.refresh();
    });
  }

  async function startStripeConnect(): Promise<void> {
    await run('connect', async () => {
      const res = await authedFetch('/v1/operators/me/connect/onboarding-link', { method: 'POST' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `Could not start Stripe payout setup (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
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
    <div className="space-y-6 max-w-3xl">
      {error ? (
        <Banner tone="error">{error}</Banner>
      ) : null}
      {info ? <Banner tone="success">{info}</Banner> : null}

      {/* ── Business profile ──────────────────────────────────────────── */}
      <Card title="Business profile" description="Shown to callers and used to format messages.">
        <Field label="Business name">
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full"
          />
        </Field>
        <Field label="Timezone" hint="IANA name — e.g. America/New_York, America/Los_Angeles">
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm w-full font-mono"
          />
        </Field>
        <Field label="Your mobile (read-only)" hint="Set at signup. Reach us to change.">
          <div className="text-sm font-mono text-muted">{formatE164(operator.personal_phone_e164)}</div>
        </Field>
        <SaveButton busy={busy === 'save'} onClick={saveProfile} />
      </Card>

      {/* ── Booking fee + economics ──────────────────────────────────── */}
      <Card
        title="Booking fee"
        description="Charge a non-refundable deposit before confirming the slot. Cuts down on no-shows."
      >
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={feeEnabled}
            onChange={(e) => setFeeEnabled(e.target.checked)}
          />
          Collect a booking fee
        </label>
        {feeEnabled && (
          <>
            <Field label="Amount (USD)">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={feeDollars}
                onChange={(e) => setFeeDollars(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm w-32"
              />
            </Field>
            {feeCents > 0 && (
              <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-sm">
                <div className="text-xs text-muted uppercase tracking-wide mb-2">
                  For a ${(feeCents / 100).toFixed(2)} deposit
                </div>
                <EconomicsRow label="Card processing (2.9% + 30¢)" amount={-stripeProcessingCents} />
                <EconomicsRow label={`BookingBlues fee (${(takeBps / 100).toFixed(0)}%)`} amount={-platformCents} />
                <div className="border-t border-slate-200 mt-2 pt-2">
                  <EconomicsRow label="You get" amount={operatorTakeCents} bold />
                </div>
              </div>
            )}
            <ConnectStatusNotice status={connectStatus} chargeable={feeChargeable} />
          </>
        )}
        <SaveButton busy={busy === 'save'} onClick={saveProfile} />
      </Card>

      {/* ── Stripe Connect ───────────────────────────────────────────── */}
      <Card
        title="Payouts (Stripe Connect)"
        description="Where booking-fee money lands. BookingBlues collects, takes our cut, deposits the rest to your bank."
      >
        <ConnectStatusBadge status={connectStatus} />
        <p className="text-sm text-muted">
          {connectStatus === 'active' ? (
            <>
              Your account is ready to accept fees. Manage details in the{' '}
              <a
                href={
                  operator.stripe_connect_account_id
                    ? `https://dashboard.stripe.com/${operator.stripe_connect_account_id}`
                    : '#'
                }
                target="_blank"
                rel="noreferrer"
                className="text-accent"
              >
                Stripe Express dashboard
              </a>
              .
            </>
          ) : connectStatus === 'pending' ? (
            <>Stripe is still verifying your account. Finish any remaining steps below.</>
          ) : (
            <>Connect a bank account so we can deposit booking fees directly. ~2 minutes.</>
          )}
        </p>
        {connectStatus !== 'active' && (
          <button
            type="button"
            onClick={startStripeConnect}
            disabled={busy === 'connect'}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'connect'
              ? 'Opening Stripe…'
              : connectStatus === 'pending'
                ? 'Continue Stripe setup'
                : 'Set up payouts with Stripe'}
          </button>
        )}
      </Card>

      {/* ── Integrations ─────────────────────────────────────────────── */}
      <Card title="Integrations">
        <IntegrationRow
          name="Google Calendar"
          state={operator.google_calendar_id ? 'connected' : 'disconnected'}
          detail={operator.google_calendar_id ?? 'Not connected'}
          action={
            operator.google_calendar_id ? (
              <button
                type="button"
                onClick={disconnectGoogle}
                disabled={busy === 'disconnect-google'}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === 'disconnect-google' ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : null
          }
        />
        <IntegrationRow
          name="Twilio number"
          state={operator.twilio_number_e164 ? 'connected' : 'disconnected'}
          detail={
            operator.twilio_number_e164 ? formatE164(operator.twilio_number_e164) : 'Not provisioned'
          }
        />
      </Card>

      {/* ── Billing ──────────────────────────────────────────────────── */}
      <Card
        title="Subscription"
        description="Your BookingBlues plan. Manage card, change plans, or cancel via the customer portal."
      >
        <div className="flex items-center justify-between">
          <div className="text-sm">
            Status:{' '}
            <span
              className={`font-medium ${
                operator.subscription_status === 'active'
                  ? 'text-emerald-700'
                  : operator.subscription_status === 'trialing'
                    ? 'text-amber-700'
                    : 'text-red-700'
              }`}
            >
              {operator.subscription_status ?? 'none'}
            </span>
            {operator.trial_ends_at && operator.subscription_status === 'trialing' && (
              <span className="ml-2 text-xs text-muted">
                ends {new Date(operator.trial_ends_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={openBillingPortal}
            disabled={busy === 'billing-portal'}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'billing-portal' ? 'Opening…' : 'Open billing portal'}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────

type ConnectStatus = 'not_started' | 'pending' | 'active';

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      <header>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description ? <p className="text-xs text-muted mt-0.5">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium text-muted mb-1">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function SaveButton({ busy, onClick }: { busy: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 self-start"
    >
      {busy ? 'Saving…' : 'Save'}
    </button>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'success';
  children: React.ReactNode;
}): JSX.Element {
  const cls =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return <div className={`rounded-md border p-3 text-sm ${cls}`}>{children}</div>;
}

function EconomicsRow({
  label,
  amount,
  bold,
}: {
  label: string;
  amount: number;
  bold?: boolean;
}): JSX.Element {
  const dollars = (amount / 100).toFixed(2);
  const positive = amount >= 0;
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-ink' : 'text-muted'}`}>
      <span>{label}</span>
      <span className={`font-mono ${!positive ? 'text-red-600' : ''}`}>
        {positive ? '$' : '-$'}{Math.abs(Number(dollars)).toFixed(2)}
      </span>
    </div>
  );
}

function ConnectStatusBadge({ status }: { status: ConnectStatus }): JSX.Element {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-medium text-emerald-700">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Active — charges + payouts enabled
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Pending verification
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      Not connected
    </span>
  );
}

function ConnectStatusNotice({
  status,
  chargeable,
}: {
  status: ConnectStatus;
  chargeable: boolean;
}): JSX.Element | null {
  if (chargeable) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <strong className="font-medium">Heads up:</strong> we won&apos;t actually charge fees yet —{' '}
      {status === 'not_started'
        ? 'finish Stripe payout setup below.'
        : status === 'pending'
          ? 'Stripe is still verifying your payout account.'
          : 'check your subscription status.'}{' '}
      Until then, the bot books appointments without a fee.
    </div>
  );
}

function IntegrationRow({
  name,
  state,
  detail,
  action,
}: {
  name: string;
  state: 'connected' | 'disconnected';
  detail: string;
  action?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full ${
            state === 'connected' ? 'bg-emerald-500' : 'bg-slate-300'
          }`}
        />
        <div>
          <div className="text-sm font-medium text-ink">{name}</div>
          <div className="text-xs text-muted font-mono">{detail}</div>
        </div>
      </div>
      {action}
    </div>
  );
}
