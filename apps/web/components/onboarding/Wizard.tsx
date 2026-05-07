'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmModal } from '../ConfirmModal';
import { getSupabaseBrowserClient } from '../../lib/supabase/browser';
import { publicEnv } from '../../lib/env';
import { CarrierForwarding } from './CarrierForwarding';
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
    op?.booking_fee_cents != null
      ? (op.booking_fee_cents / 100).toFixed(2)
      : (publicEnv.NEXT_PUBLIC_DEFAULT_BOOKING_FEE_CENTS / 100).toFixed(2),
  );

  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [disconnectGoogleOpen, setDisconnectGoogleOpen] = useState(false);

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
      if (!res.ok) throw new Error(`Could not save category (${res.status})`);
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
        throw new Error(detail.detail ?? `Could not get a number (${res.status})`);
      }
      router.refresh();
    });
  }

  async function releaseTwilioConfirmed(): Promise<void> {
    const res = await authedFetch('/v1/operators/me/twilio-number', { method: 'DELETE' });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail ?? `Could not release the number (${res.status})`);
    }
    setReleaseModalOpen(false);
    router.refresh();
  }

  async function disconnectGoogleConfirmed(): Promise<void> {
    const res = await authedFetch('/v1/operators/me/google/disconnect', { method: 'POST' });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail ?? `Could not disconnect Google (${res.status})`);
    }
    setDisconnectGoogleOpen(false);
    router.refresh();
  }

  async function startGoogleConnect(): Promise<void> {
    await handle(async () => {
      const res = await authedFetch('/v1/operators/me/google/connect', { method: 'POST' });
      if (!res.ok) throw new Error('Could not start Google sign-in');
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    });
  }

  async function startStripeConnect(): Promise<void> {
    await handle(async () => {
      const res = await authedFetch('/v1/operators/me/connect/onboarding-link', { method: 'POST' });
      if (!res.ok) throw new Error('Could not start Stripe payout setup');
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
      if (!res.ok) throw new Error('Could not start checkout');
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
        throw new Error(detail.detail ?? 'Could not save the booking fee');
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
        description="7-day free trial. We need a card up front, but you won't be charged until day 7."
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
        title="Pick your trade"
        description="The AI only handles calls about this trade. Calls outside it get a polite handoff."
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
        title="Get your BookingBlues phone number"
        description="A new local US number we'll use to text customers when you miss their call. You'll forward your real business line to it in step 7."
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
              Get my number
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <p className="text-sm font-mono">{op?.twilio_number_e164}</p>
            <button
              type="button"
              onClick={() => setReleaseModalOpen(true)}
              className="text-xs text-red-700 hover:underline"
              title="Permanently release the number"
            >
              Release this number
            </button>
          </div>
        )}
      </StepCard>

      <StepCard
        number={4}
        title="Connect your Google Calendar"
        description="So the AI knows when you're free and can put new appointments on your calendar automatically."
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
            onClick={() => setDisconnectGoogleOpen(true)}
            className="text-xs text-red-700 hover:underline"
          >
            Disconnect
          </button>
        )}
      </StepCard>

      <StepCard
        number={5}
        title="Set up payouts (only if you charge a booking fee)"
        description="Lets us send the booking-fee money straight to your bank. Skip this step if you don't take deposits."
        done={stripeConnectDone}
      >
        {!stripeConnectDone ? (
          <button
            type="button"
            onClick={startStripeConnect}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            Set up payouts with Stripe
          </button>
        ) : (
          <p className="text-sm text-emerald-700">
            ✓ Payouts ready — money goes straight to your bank.
          </p>
        )}
      </StepCard>

      <StepCard
        number={6}
        title="Booking fee"
        description="Charge a non-refundable deposit before confirming the slot. Cuts down on no-shows."
        done={feeDecided}
      >
        <div className="space-y-3">
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
          {pendingFeeEnabled && Number(pendingFeeDollars) > 0 ? (
            <FeeBreakdown depositDollars={Number(pendingFeeDollars)} />
          ) : null}
        </div>
      </StepCard>

      <StepCard
        number={7}
        title="Forward your real business line"
        description="When customers call your real number and you don't pick up, your phone carrier sends the call to BookingBlues. Your phone still rings normally — only missed calls get caught by the AI."
        done={false}
      >
        {twilioDone ? (
          <CarrierForwarding twilioNumber={op!.twilio_number_e164!} />
        ) : (
          <p className="text-sm text-muted">
            Get your BookingBlues number first (step 3) — once you have it we&apos;ll show you the
            short code to dial on your phone for your carrier.
          </p>
        )}
      </StepCard>

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <ConfirmModal
        open={releaseModalOpen}
        onClose={() => setReleaseModalOpen(false)}
        title="Release this phone number?"
        confirmLabel="Yes, release it permanently"
        cancelLabel="Keep it"
        severity="danger"
        {...(op?.twilio_number_e164 ? { typeToConfirm: op.twilio_number_e164 } : {})}
        body={
          <div className="space-y-3">
            <p>
              You&apos;re about to give up <span className="font-mono">{op?.twilio_number_e164}</span>.
              This is permanent and almost always a bad idea unless you&apos;re shutting down or
              switching to a new business phone.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              <li>The number goes back into the public pool — anyone can buy it next.</li>
              <li>We <strong>cannot</strong> get this exact number back for you later.</li>
              <li>Customers who saved this number lose touch with you.</li>
              <li>Your call-forwarding setup (from step 7) becomes useless until you set it up
                again with a new number.</li>
            </ul>
            <p className="text-xs">
              If you just want to pause for a while, contact support instead — we can put your
              account on hold without losing the number.
            </p>
          </div>
        }
        onConfirm={releaseTwilioConfirmed}
      />

      <ConfirmModal
        open={disconnectGoogleOpen}
        onClose={() => setDisconnectGoogleOpen(false)}
        title="Disconnect your Google Calendar?"
        confirmLabel="Yes, disconnect"
        cancelLabel="Keep it connected"
        severity="warning"
        body={
          <div className="space-y-2">
            <p>
              The AI won&apos;t be able to check your availability or add new appointments to your
              calendar until you reconnect.
            </p>
            <p className="text-xs text-muted">
              Appointments already on your calendar stay where they are — nothing gets deleted.
              You can reconnect anytime.
            </p>
          </div>
        }
        onConfirm={disconnectGoogleConfirmed}
      />
    </div>
  );
}

/**
 * Mirrors apps/api/src/modules/payments/pricing.ts at the same default config.
 * The server is authoritative — this is just for the wizard's "what do I keep"
 * preview. Values clamp the same way the server clamps.
 */
function FeeBreakdown({ depositDollars }: { depositDollars: number }): JSX.Element {
  const depositCents = Math.round(depositDollars * 100);
  const takeRateBps = publicEnv.NEXT_PUBLIC_PLATFORM_TAKE_RATE_BPS;

  // Stripe US standard: 2.9% + 30¢ per charge.
  const stripeFeeCents = Math.ceil(depositCents * 0.029) + 30;
  const requestedAppFee = Math.max(
    Math.floor((depositCents * takeRateBps) / 10_000),
    100, // mirrors MIN_PLATFORM_FEE_CENTS default
  );
  const cap = Math.max(0, depositCents - stripeFeeCents);
  const platformFeeCents = Math.min(requestedAppFee, cap);
  const operatorKeepsCents = depositCents - stripeFeeCents - platformFeeCents;

  const fmt = (c: number): string => `$${(c / 100).toFixed(2)}`;
  const ratePct = (takeRateBps / 100).toFixed(0);

  return (
    <div className="rounded-md border bg-slate-50 p-3 text-xs">
      <div className="font-medium mb-2">For a {fmt(depositCents)} deposit:</div>
      <ul className="space-y-1 text-muted">
        <li className="flex justify-between"><span>Card processing fee (2.9% + 30¢)</span><span className="font-mono">−{fmt(stripeFeeCents)}</span></li>
        <li className="flex justify-between"><span>BookingBlues fee ({ratePct}%)</span><span className="font-mono">−{fmt(platformFeeCents)}</span></li>
        <li className="flex justify-between font-medium text-ink border-t pt-1"><span>You get</span><span className="font-mono">{fmt(operatorKeepsCents)}</span></li>
      </ul>
    </div>
  );
}
