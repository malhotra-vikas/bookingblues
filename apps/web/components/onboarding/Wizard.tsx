'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSupabaseBrowserClient } from '../../lib/supabase/browser';
import { publicEnv } from '../../lib/env';
import { StepCard } from './StepCard';

interface Operator {
  id: string;
  business_name: string;
  category: string | null;
  twilio_number_e164: string | null;
  google_calendar_id: string | null;
  stripe_connect_account_id: string | null;
  stripe_connect_charges_enabled: boolean;
  stripe_connect_payouts_enabled: boolean;
  booking_fee_enabled: boolean;
  booking_fee_cents: number | null;
  subscription_status: string | null;
  onboarding_completed_at: string | null;
}

type Category = { slug: string; display_name: string };

const CATEGORIES: Category[] = [
  { slug: 'plumbing', display_name: 'Plumbing' },
  { slug: 'hvac', display_name: 'HVAC' },
  { slug: 'electrical', display_name: 'Electrical' },
  { slug: 'roofing', display_name: 'Roofing' },
  { slug: 'garage_door', display_name: 'Garage Door' },
];

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

export function Wizard({ initial }: { initial: Operator | null }): JSX.Element {
  const router = useRouter();
  const op = initial;
  const [error, setError] = useState<string | null>(null);

  const [pendingCategory, setPendingCategory] = useState(op?.category ?? '');
  const [pendingAreaCode, setPendingAreaCode] = useState('');
  const [pendingFeeEnabled, setPendingFeeEnabled] = useState(op?.booking_fee_enabled ?? false);
  const [pendingFeeDollars, setPendingFeeDollars] = useState(
    op?.booking_fee_cents != null ? (op.booking_fee_cents / 100).toFixed(2) : '',
  );

  async function handle<T>(fn: () => Promise<T>): Promise<T | null> {
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      return null;
    }
  }

  async function saveCategory(): Promise<void> {
    await handle(async () => {
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({ category: pendingCategory }),
      });
      if (!res.ok) throw new Error(`PATCH /v1/operators/me failed: ${res.status}`);
      router.refresh();
    });
  }

  async function provisionTwilio(): Promise<void> {
    await handle(async () => {
      const body: Record<string, string> = {};
      if (pendingAreaCode) body.area_code = pendingAreaCode;
      const res = await authedFetch('/v1/operators/me/twilio-number', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `provision failed: ${res.status}`);
      }
      router.refresh();
    });
  }

  async function releaseTwilio(currentNumber: string): Promise<void> {
    const confirmed = window.confirm(
      `WARNING: Releasing ${currentNumber} is permanent.\n\n` +
        `Twilio puts the number back in the public pool. We can NOT guarantee ` +
        `you'll get the same number back if you change your mind. ` +
        `Customers who saved this number to their phone will lose touch.\n\n` +
        `Provision a fresh number? You'll lose all forwarding rules pointed at this one.`,
    );
    if (!confirmed) return;
    const typed = window.prompt(
      `To confirm, type the number exactly:\n${currentNumber}`,
    );
    if (typed !== currentNumber) {
      setError('Number did not match — release cancelled.');
      return;
    }
    await handle(async () => {
      const res = await authedFetch('/v1/operators/me/twilio-number', { method: 'DELETE' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `release failed: ${res.status}`);
      }
      router.refresh();
    });
  }

  async function disconnectGoogle(): Promise<void> {
    const confirmed = window.confirm(
      `Disconnect Google Calendar?\n\n` +
        `The bot will not be able to check your availability or create events ` +
        `until you reconnect. Existing booked appointments stay in your calendar.`,
    );
    if (!confirmed) return;
    await handle(async () => {
      const res = await authedFetch('/v1/operators/me/google/disconnect', { method: 'POST' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `disconnect failed: ${res.status}`);
      }
      router.refresh();
    });
  }

  async function startGoogleConnect(): Promise<void> {
    await handle(async () => {
      const res = await authedFetch('/v1/operators/me/google/connect', { method: 'POST' });
      if (!res.ok) throw new Error(`google connect failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  async function startStripeConnect(): Promise<void> {
    await handle(async () => {
      const res = await authedFetch('/v1/operators/me/connect/onboarding-link', { method: 'POST' });
      if (!res.ok) throw new Error(`stripe connect failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  async function startBilling(plan: 'starter' | 'pro'): Promise<void> {
    await handle(async () => {
      const res = await authedFetch('/v1/billing/checkout-session', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error(`checkout failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  async function saveFee(): Promise<void> {
    await handle(async () => {
      const cents = pendingFeeEnabled
        ? Math.max(0, Math.round(Number(pendingFeeDollars) * 100))
        : null;
      const res = await authedFetch('/v1/operators/me', {
        method: 'PATCH',
        body: JSON.stringify({
          booking_fee_enabled: pendingFeeEnabled,
          ...(cents != null ? { booking_fee_cents: cents } : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail ?? `save fee failed: ${res.status}`);
      }
      router.refresh();
    });
  }

  const subscribed = op?.subscription_status === 'trialing' || op?.subscription_status === 'active';
  const categoryDone = !!op?.category;
  const twilioDone = !!op?.twilio_number_e164;
  const googleDone = !!op?.google_calendar_id;
  const stripeConnectDone =
    !!op?.stripe_connect_account_id &&
    op.stripe_connect_charges_enabled &&
    op.stripe_connect_payouts_enabled;
  const feeDecided = op != null && (!op.booking_fee_enabled || op.booking_fee_cents != null);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <StepCard
        number={1}
        title="Subscribe"
        description="7-day free trial. Card required up front."
        done={!!subscribed}
      >
        {!subscribed ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => startBilling('starter')}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white"
            >
              Start trial — Starter
            </button>
            <button
              type="button"
              onClick={() => startBilling('pro')}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Start trial — Pro
            </button>
          </div>
        ) : null}
      </StepCard>

      <StepCard
        number={2}
        title="Pick your trade category"
        description="The bot will only handle calls inside this category."
        done={categoryDone}
      >
        <div className="flex gap-2">
          <select
            value={pendingCategory}
            onChange={(e) => setPendingCategory(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">— Select —</option>
            {CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.display_name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pendingCategory}
            onClick={saveCategory}
            className="rounded-md bg-accent px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </StepCard>

      <StepCard
        number={3}
        title="Get your Twilio number"
        description="A local US number we'll forward your missed calls to."
        done={twilioDone}
      >
        {!twilioDone ? (
          <div className="flex gap-2 items-center">
            <input
              placeholder="Area code (optional, e.g. 415)"
              value={pendingAreaCode}
              onChange={(e) => setPendingAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm w-48"
            />
            <button
              type="button"
              onClick={provisionTwilio}
              className="rounded-md bg-accent px-3 py-2 text-sm text-white"
            >
              Provision number
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm font-mono">{op?.twilio_number_e164}</p>
            <button
              type="button"
              onClick={() => releaseTwilio(op!.twilio_number_e164!)}
              className="text-xs text-red-700 hover:underline"
              title="Permanently release the number"
            >
              Release
            </button>
          </div>
        )}
      </StepCard>

      <StepCard
        number={4}
        title="Connect Google Calendar"
        description="So the bot knows when you're free."
        done={googleDone}
      >
        {!googleDone ? (
          <button
            type="button"
            onClick={startGoogleConnect}
            className="rounded-md bg-accent px-4 py-2 text-sm text-white"
          >
            Connect Google
          </button>
        ) : (
          <button
            type="button"
            onClick={disconnectGoogle}
            className="text-xs text-red-700 hover:underline"
          >
            Disconnect
          </button>
        )}
      </StepCard>

      <StepCard
        number={5}
        title="Connect your Stripe Connect account (optional)"
        description="Required only if you collect a booking fee. We onboard via Stripe Express."
        done={stripeConnectDone}
      >
        {!stripeConnectDone ? (
          <button
            type="button"
            onClick={startStripeConnect}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Start Stripe Connect onboarding
          </button>
        ) : (
          <p className="text-sm text-muted">Charges + payouts enabled.</p>
        )}
      </StepCard>

      <StepCard
        number={6}
        title="Booking fee"
        description="Charge a non-refundable deposit before confirming the slot."
        done={feeDecided}
      >
        <div className="flex items-end gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pendingFeeEnabled}
              onChange={(e) => setPendingFeeEnabled(e.target.checked)}
            />
            Collect a booking fee
          </label>
          {pendingFeeEnabled ? (
            <div>
              <label className="block text-xs text-muted">Amount (USD)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={pendingFeeDollars}
                onChange={(e) => setPendingFeeDollars(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm w-32"
              />
            </div>
          ) : null}
          <button
            type="button"
            onClick={saveFee}
            className="rounded-md bg-accent px-3 py-2 text-sm text-white"
          >
            Save
          </button>
        </div>
      </StepCard>
    </div>
  );
}
